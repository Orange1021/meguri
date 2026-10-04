# Asset Cover Race and Restore Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent scans from overwriting ready manual covers and make automatic-cover restoration queue and process only the requested video without blocking its IPC request on unrelated asset work.

**Architecture:** Keep the existing per-database asset lock and background worker, but add a targeted claim path for one video's automatic cover. The restore IPC handler performs the durable enqueue synchronously and detaches the targeted processing promise; completion projects the preferred asset and emits a status-bearing thumbnail event. The scan persistence path checks the durable manual-cover row before changing the file thumbnail projection.

**Tech Stack:** Electron 42, Node/TypeScript, better-sqlite3, Vitest/Vitest-through-Electron for core tests, React 19, TanStack Query, and existing typed IPC/event DTOs.

---

### Task 1: Add the failing core regression for scan/manual-cover ordering

**Files:**
- Modify: `electron/core/__tests__/jobsIdentity.test.ts`
- Modify: `electron/core/__tests__/jobsIdentity.test.ts` imports to use `importManualCover`, `assetAbsolutePath`, and `setThumb`

- [x] **Step 1: Add a test that selects a manual cover during thumbnail generation**

Add a test in `describe("runScan identity integration", ...)` that creates a
manual image before the scan, overrides the mocked `generateThumb()` to import
the manual cover and set the file's current projection before returning the
generated thumbnail, then asserts that the scan leaves the manual path in
`files.thumb_path`:

```ts
it("does not replace a manual cover selected while scan thumbnail work is running", async () => {
  const media = await import("../media.js");
  const selectedCover = path.join(root, "selected.jpg");
  await fsp.writeFile(selectedCover, "manual cover");

  let manualPath: string | null = null;
  vi.mocked(media.generateThumb).mockImplementationOnce(
    async (_src, _kind, destination) => {
      const row = db
        .prepare(
          "SELECT id, video_id AS videoId FROM files WHERE rel_path = ?",
        )
        .get("clip.mp4") as { id: number; videoId: string };
      const manual = await importManualCover(core, row.videoId, selectedCover, 2);
      manualPath = assetAbsolutePath(core.assetsDir(), manual.path);
      setThumb(db, row.id, manualPath, "done");
      await fsp.writeFile(destination, "automatic thumbnail");
      return true;
    },
  );

  await runScan(core, "job-manual-race", () => {});

  expect(
    db
      .prepare(
        "SELECT thumb_path AS thumbPath, thumb_status AS thumbStatus FROM files WHERE rel_path = ?",
      )
      .get("clip.mp4"),
  ).toEqual({ thumbPath: manualPath, thumbStatus: "done" });
});
```

- [x] **Step 2: Run the focused test and verify it fails for the intended reason**

Run:

```powershell
npm run test:core -- electron/core/__tests__/jobsIdentity.test.ts
```

Expected: the new test fails because `runScan()` currently writes the generated
`thumbs/<file-id>.webp` path after the mocked generator has installed the manual
cover.

### Task 2: Guard generated thumbnail projection by manual asset policy

**Files:**
- Modify: `electron/core/queries/assets.ts`
- Modify: `electron/core/jobs.ts:338-406`
- Test: `electron/core/__tests__/jobsIdentity.test.ts`

- [x] **Step 1: Add a focused query helper for ready manual covers**

Add this function beside the other asset queries:

```ts
export function hasReadyManualCover(db: DB, videoId: string): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM assets WHERE video_id = ? AND kind = 'cover' AND source = 'manual' AND status = 'ready' LIMIT 1",
      )
      .get(videoId) != null
  );
}
```

- [x] **Step 2: Read the stable identity before projecting the scan result**

In `persistOne`, resolve the file's `video_id` before the `q.setThumb()` block,
and only call `q.setThumb()` for generated/skip results when
`hasReadyManualCover(db, videoId)` is false. Keep `queueDerivedAssets()` outside
that guard so automatic fallback assets continue to be generated:

```ts
const identity = db
  .prepare("SELECT video_id AS videoId FROM files WHERE id = ?")
  .get(r.id) as { videoId: string | null } | undefined;
const manualCover =
  identity?.videoId != null && hasReadyManualCover(db, identity.videoId);

if (!manualCover) {
  if (r.skipThumb) q.setThumb(db, r.id, null, "done");
  else q.setThumb(db, r.id, r.ok ? r.dest : null, r.ok ? "done" : "error");
}

if (identity?.videoId) {
  queueDerivedAssets(db, { videoId: identity.videoId, kind: r.kind });
}
```

Remove the later duplicate identity query while preserving FTS and metadata
ordering.

- [x] **Step 3: Run the focused test and verify it passes**

Run:

```powershell
npm run test:core -- electron/core/__tests__/jobsIdentity.test.ts
```

Expected: all tests in the file pass, including the new manual-cover race test.

### Task 3: Add a targeted asset-task claim and processing path

**Files:**
- Modify: `electron/core/queries/assets.ts`
- Modify: `electron/core/assetService.ts`
- Modify: `electron/core/__tests__/assets.test.ts`

- [x] **Step 1: Add a failing targeted-restore test**

Create target and unrelated video rows, enqueue a target cover plus unrelated
cover/sheet work, call `restoreAutomaticCoverAndProcess()` for the target, and
assert that only the target task is completed and an automatic preferred asset
is returned:

```ts
it("restores and processes only the requested video's automatic cover", async () => {
  // Seed two files and their video identities in the same way as the existing
  // serialization test, with targetVideoId and otherVideoId.
  enqueueAssetTask(core.db, {
    videoId: targetVideoId,
    kind: "cover",
    source: "auto",
    now: 1,
  });
  enqueueAssetTask(core.db, {
    videoId: otherVideoId,
    kind: "cover",
    source: "auto",
    now: 1,
  });

  const asset = await assetService.restoreAutomaticCoverAndProcess(
    core,
    targetVideoId,
  );

  expect(asset?.source).toBe("auto");
  expect(
    core.db
      .prepare(
        "SELECT video_id AS videoId, status FROM asset_tasks ORDER BY video_id",
      )
      .all(),
  ).toEqual([
    { videoId: otherVideoId, status: "queued" },
    { videoId: targetVideoId, status: "completed" },
  ]);
});
```

- [x] **Step 2: Run the targeted test and verify it fails**

Run:

```powershell
npm run test:core -- electron/core/__tests__/assets.test.ts
```

Expected: the current implementation claims the first global tasks or does not
return the targeted asset as specified.

- [x] **Step 3: Add a video-scoped claim helper**

Refactor the common claim/update code if useful, then add:

```ts
export function claimAutomaticCoverTaskForVideo(
  db: DB,
  videoId: string,
  now: number,
): AssetTaskRow | null {
  const row = db
    .prepare(
      `SELECT task_id AS taskId, video_id AS videoId, kind, source,
              generation_version AS generationVersion, status, attempts,
              next_attempt_at AS nextAttemptAt, error_code AS errorCode
         FROM asset_tasks
        WHERE video_id = ? AND kind = 'cover' AND source = 'auto'
          AND status IN ('queued', 'failed') AND next_attempt_at <= ?
        ORDER BY next_attempt_at, created_at
        LIMIT 1`,
    )
    .get(videoId, now) as AssetTaskRow | undefined;
  if (!row) return null;

  const result = db
    .prepare(
      "UPDATE asset_tasks SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE task_id = ? AND status IN ('queued','failed')",
    )
    .run(now, row.taskId);
  return result.changes === 0
    ? null
    : { ...row, status: "running", attempts: row.attempts + 1 };
}
```

- [x] **Step 4: Process a supplied task list without claiming unrelated work**

Extract the per-task loop from `processPendingAssetTasksUnlocked()` into a
helper that accepts `AssetTaskRow[]`. Keep the existing global function calling
`claimAssetTasks()`, and add a targeted function that calls the new video-scoped
claim helper while already inside `withAssetTaskLock()`.

- [x] **Step 5: Make restore enqueue before waiting and return the preferred asset**

Implement the restore flow in this order:

```ts
export async function restoreAutomaticCoverAndProcess(
  core: Core,
  videoId: string,
  options: { limit?: number } = {},
): Promise<AssetRow | null> {
  restoreAutomaticCover(core.db, videoId);
  await withAssetTaskLock(core.db, async () => {
    await processAutomaticCoverForVideoUnlocked(core, videoId, options);
  });
  return preferredAsset(core.db, videoId, "cover");
}
```

The function must remain serialized by the existing lock, but its claim query
must be limited to the requested video's automatic cover task.

- [x] **Step 6: Run core asset tests and verify they pass**

Run:

```powershell
npm run test:core -- electron/core/__tests__/assets.test.ts
```

Expected: all asset tests pass, including the targeted-restore regression and
the existing serialization/recovery tests.

### Task 4: Detach restore IPC and publish success/failure state

**Files:**
- Modify: `shared/ipc/schema.ts`
- Modify: `electron/ipc/assets.ts`
- Modify: `src/routes/MediaDetail/useThumbVersion.ts`
- Modify: `src/audio/AudioPlayerBar.tsx`
- Modify: `src/lib/queryCache.ts`
- Modify: `src/routes/Home/index.tsx`
- Test: renderer tests covering thumbnail events, or add focused tests beside the changed hooks

- [x] **Step 1: Add an optional readiness flag to thumbnail events**

Extend `ThumbDoneSchema` without breaking existing successful producers:

```ts
export const ThumbDoneSchema = z.object({
  id: z.number(),
  workspaceId: z.string().nullable().optional(),
  /** False means the thumbnail attempt finished without a usable file. */
  ready: z.boolean().optional(),
});
```

Consumers interpret `undefined` as `true` for backward compatibility.

- [x] **Step 2: Return from the restore IPC handler immediately**

Keep the synchronous `q.setThumb(..., null, "pending")`, then start the promise
without awaiting it. On completion resolve the asset path and set `done`; when no
asset or an exception occurs set `error`. Emit exactly once after either outcome:

```ts
q.setThumb(core.db, id, null, "pending");
void restoreAutomaticCoverAndProcess(core, videoId, { limit: 1 })
  .then((asset) => {
    const assetPath = asset
      ? assetAbsolutePath(core.assetsDir(), asset.path)
      : null;
    q.setThumb(core.db, id, assetPath, assetPath ? "done" : "error");
    ctx.emit("thumb:done", { id, workspaceId, ready: assetPath != null });
  })
  .catch((error) => {
    log.warn("automatic cover restore failed", error);
    q.setThumb(core.db, id, null, "error");
    ctx.emit("thumb:done", { id, workspaceId, ready: false });
  });
```

Use the existing logger import or add the scoped logger used by this IPC layer.
Do not await this chain from the `handle()` callback.

- [x] **Step 3: Make renderer event consumers honor failed attempts**

In `useThumbVersion`, patch `FileDetail` to `{ thumbStatus: "done", hasThumb: 1 }`
only when `event.ready !== false`; otherwise patch `{ thumbStatus: "error", hasThumb: 0 }`.
Make `AudioPlayerBar` set `hasCover` from the same flag rather than always true.

- [x] **Step 4: Patch list/search caches on the event**

Add a small `patchThumbnailInCaches()` helper in `src/lib/queryCache.ts` that
uses `patchFileRowInCaches()` and `patchFileDetailInCache()` with the same
`done/error` and `hasThumb` values. Call it from Home's coalesced thumbnail-event
flush so an asynchronously completed restore updates an already-loaded search
row without refetching every page.

- [x] **Step 5: Add/adjust renderer event tests and run them**

Cover both `ready: true`/omitted and `ready: false` paths, then run:

```powershell
npm run test:renderer -- src/routes/MediaDetail src/audio/__tests__/AudioPlayerBar.test.tsx src/lib
```

Expected: all focused renderer tests pass and failed events never create a
thumbnail URL.

### Task 5: Full verification and review

**Files:**
- Review: all modified files and `docs/superpowers/specs/2026-10-02-asset-cover-race-design.md`
- Review: `docs/superpowers/plans/2026-10-02-asset-cover-race.md`

- [x] **Step 1: Run all core and renderer tests**

```powershell
npm run test:core
npm run test:renderer
```

- [x] **Step 2: Run type checking and build**

```powershell
npm run typecheck
npm run build
```

- [x] **Step 3: Inspect the final diff and verify scope**

```powershell
git diff --check
git diff --stat
git status --short
```

Confirm that only the cover race/restore scheduling implementation, tests, and
the focused design/plan documentation changed; do not touch `Data/`, `Media/`,
generated binaries, or unrelated UI behavior.
