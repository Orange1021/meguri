# Asset Cover Race and Restore Scheduling Design

## Goal

Make manual video covers authoritative while a scan or derived-asset worker is
running, and make restoring an automatic cover return immediately without
waiting for unrelated asset work in the same workspace database.

## Requirements

1. A scan may continue to generate an automatic thumbnail/asset, but it must
   never replace `files.thumb_path` while a ready manual cover exists.
2. Restoring an automatic cover must retire the manual cover and enqueue the
   current video's automatic cover synchronously, then return from IPC without
   waiting for the global asset worker or claiming unrelated tasks.
3. The current video's cover task must be processed through the existing
   per-database serialization boundary. Once it finishes, the preferred cover
   is projected back to `files.thumb_path` and a thumbnail event is emitted.
4. Success and failure must be distinguishable to the renderer. Failure leaves
   the thumbnail slot empty/error rather than falsely advertising a file.
5. Existing background asset processing, retry/backoff, portable paths, and
   manual-cover persistence must remain intact.

## Design

### Scan projection guard

`runScan()` keeps the current metadata and thumbnail generation flow. Before it
writes the generated thumbnail result into `files.thumb_path`, it resolves the
file's stable `video_id` and checks for a `cover/manual/ready` asset. If one is
present, the generated result is persisted only as derived work; the existing
manual `thumb_path` and `thumb_status` are left untouched. This protects the
projection at the point where the race currently occurs without suppressing
automatic assets needed as a future fallback.

### Targeted restore lane

`restoreAutomaticCoverAndProcess()` first retires the manual asset and upserts
the current video's automatic cover task before it waits on the per-database
asset lock. It then claims only that video's automatic cover task. The function
may wait for an already-running task to release the database lock, but it never
consumes the unrelated queue. The IPC handler starts this promise without
awaiting it, so the mutation resolves after queueing rather than after FFmpeg
work completes.

After the targeted task finishes, the handler resolves the preferred cover. A
ready asset is written to `files.thumb_path` with status `done`; no preferred
asset writes a null path with status `error`. Both outcomes emit `thumb:done`
with an optional `ready` flag, where omitted/true preserves the existing
successful-event behavior and false tells the renderer to remove the cover.

### Renderer cache update

The existing thumbnail event remains the synchronization point. Consumers treat
`ready: false` as an unavailable cover instead of setting `hasThumb = 1`. The
list/detail caches are patched with the same `done/error` and `hasThumb` values,
while the existing cache-busting version still forces successful replacements
to reload.

## Error handling

- Asset-generation failures are already recorded by `failAssetTask()` with
  retry backoff. The targeted restore reports the failure to the renderer but
  does not reject the original IPC mutation.
- A failure while projecting or scheduling is caught by the detached handler,
  logged, and emits `ready: false` after setting the file slot to `error`.
- A later manual-cover selection remains authoritative: the completion path
  resolves the preferred asset immediately before projecting, so a newly chosen
  manual asset wins over an automatic result.

## Verification

- Core regression: a manual cover selected while `generateThumb()` is in flight
  remains the file's thumbnail after `runScan()` persists the generated result.
- Core queue regression: targeted restore completes the current cover task and
  leaves unrelated queued/failed tasks untouched.
- Core concurrency regression: a targeted restore queued behind one in-flight
  batch runs after that batch, before consuming the rest of the global queue.
- Renderer regression: a failed thumbnail event clears availability and a
  successful event restores it and increments the cache-busting version.
- Run the relevant core/renderer tests, typecheck, build, and the full test
  command before completion.
