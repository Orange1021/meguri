// Scan pipeline: walk → sync → thumbnail/meta (parallel).
// Progress is reported via callbacks.
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Core } from "./index.js";
import { nowUnix, type DB } from "./db.js";
import {
  emptyScanStats,
  syncFiles,
  walk,
  type ScanStats,
  type IdentityTarget,
} from "./scan.js";
import { extractMeta, generateThumb } from "./media.js";
import { queueDerivedAssets } from "./assetService.js";
import * as q from "./queries.js";
import { syncFts } from "./tags.js";
import {
  applyAutoMetaTags,
  backfillAutoMetaTags,
  needsAutoMetaBackfill,
} from "./autoMetaTags.js";
import { pool } from "./concurrency.js";
import { SCAN_POOL_WIDTH, withScanDecodeSlot } from "./mediaConcurrency.js";
import { scopedLog } from "./logger.js";
import type { Kind } from "./types.js";
import {
  prepareIdentity,
  reconcileFileIdentity,
  recordMoveConflict,
  type PreparedIdentity,
} from "./scanService.js";
import type { ExtractedMeta } from "./media.js";
import { clearNonVideoThumbnailPaths } from "./thumbnailPaths.js";

const log = scopedLog("scan");

export type JobEvent =
  | {
      type: "progress";
      jobId: string;
      phase: string;
      done: number;
      total: number;
    }
  | { type: "thumbDone"; id: number }
  | { type: "done"; jobId: string; stats: ScanStats; aborted?: boolean };

/**
 * Invalidate the derived file index (FTS rows and extracted media state) for this root,
 * so the next scan rebuilds it from the filesystem. Keep the physical rows soft-deleted
 * during this operation: their quick-v1 fingerprints remain attached as historical
 * evidence, allowing the new scan to recover the same logical `video_id` after a rebuild.
 * Durable metadata (file_meta / meta_tags / play_history) is keyed by meta_key and remains
 * available for the revalidated rows.
 *
 * Note: the removed-from-index exclusions (files.excluded_at) live on the files rows and are
 * therefore wiped too — a rebuild deliberately resets that list, so files previously removed
 * from the index reappear. This is spelled out in the rebuild confirmation dialog.
 */
async function clearIndex(core: Core): Promise<void> {
  const { db } = core;
  const now = nowUnix();
  db.transaction(() => {
    db.prepare(
      "DELETE FROM files_fts WHERE rowid IN (SELECT id FROM files WHERE root_id = ?)",
    ).run(core.rootId);
    db.prepare(
      "UPDATE files SET deleted_at = COALESCE(deleted_at, ?), excluded_at = NULL, " +
        "width = NULL, height = NULL, duration = NULL, codec = NULL, fps = NULL, " +
        "captured_at = NULL, meta = NULL, thumb_path = NULL, thumb_status = 'pending' " +
        "WHERE root_id = ?",
    ).run(now, core.rootId);
  })();
  // Thumbnails are invalidated by the reset above, so wipe them to avoid stale
  // previews. Async with a small concurrent pool — a synchronous unlink loop over
  // tens of thousands of thumbnails would block the main thread.
  const thumbs = core.thumbsDir();
  let names: string[] = [];
  try {
    names = await fsp.readdir(thumbs);
  } catch {
    return; // thumbs dir may not exist yet
  }
  await pool(names, 8, async (name) => {
    try {
      await fsp.rm(path.join(thumbs, name), { force: true });
    } catch {
      /* best-effort; a leftover thumb is overwritten by the rescan */
    }
  });
}

interface IdentityRunStats {
  reconciled: number;
  issues: number;
  moveConflicts: number;
}

interface IdentityError {
  code: string;
  detail: string;
}

function describeIdentityError(error: unknown): IdentityError {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code:
        typeof candidate.code === "string" && candidate.code.length > 0
          ? candidate.code
          : "fingerprint_failed",
      detail:
        typeof candidate.message === "string"
          ? candidate.message
          : formatErrorDetail(error),
    };
  }
  return { code: "fingerprint_failed", detail: formatErrorDetail(error) };
}

function formatErrorDetail(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

function storedExtractedMeta(db: DB, fileId: number): ExtractedMeta {
  const row = db
    .prepare(
      "SELECT width, height, duration, codec, fps, captured_at AS capturedAt, meta " +
        "FROM files WHERE id = ?",
    )
    .get(fileId) as
    | {
        width: number | null;
        height: number | null;
        duration: number | null;
        codec: string | null;
        fps: number | null;
        capturedAt: number | null;
        meta: string | null;
      }
    | undefined;
  if (!row) throw new Error(`file ${fileId} not found`);
  let raw: unknown = null;
  if (row.meta != null) {
    try {
      raw = JSON.parse(row.meta);
    } catch {
      raw = null;
    }
  }
  return {
    width: row.width,
    height: row.height,
    duration: row.duration,
    codec: row.codec,
    fps: row.fps,
    capturedAt: row.capturedAt,
    raw,
  };
}

function identityStatsForRun(
  stats: ScanStats,
  identity: IdentityRunStats,
): ScanStats & { identity: IdentityRunStats } {
  return { ...stats, identity: { ...identity } };
}

export async function runScan(
  core: Core,
  jobId: string,
  onEvent: (e: JobEvent) => void,
  opts: { rebuild?: boolean; signal?: AbortSignal } = {},
): Promise<ScanStats> {
  const { signal } = opts;
  const { db } = core;

  const runId = randomUUID();
  q.createScanRun(db, core.rootId, runId, nowUnix());
  let phaseName = "";
  let terminal = false;
  let stats = emptyScanStats();
  const identityStats: IdentityRunStats = {
    reconciled: 0,
    issues: 0,
    moveConflicts: 0,
  };
  const setPhase = (next: string): void => {
    if (phaseName === next) return;
    q.updateScanRunPhase(db, runId, next);
    phaseName = next;
  };
  const finish = (
    status: "completed" | "aborted" | "failed",
    error?: IdentityError,
  ): void => {
    if (terminal) return;
    q.finishScanRun(
      db,
      runId,
      status,
      identityStatsForRun(stats, identityStats),
      nowUnix(),
      error,
    );
    terminal = true;
  };
  const finishAborted = (): ScanStats => {
    finish("aborted");
    onEvent({ type: "done", jobId, stats, aborted: true });
    return stats;
  };

  try {
    // A rebuild discards the derived file index (keeping durable metadata and
    // logical identities) before rescanning.
    setPhase(opts.rebuild ? "rebuild" : "walk");
    if (opts.rebuild) await clearIndex(core);
    if (signal?.aborted) return finishAborted();

    // --- walk + sync (both async with concurrent IO, so they don't block the event loop) ---
    // On SMB these phases dominate the time before thumbnails start, so report their progress.
    setPhase("walk");
    const discovered = await walk(
      core.root,
      (count) =>
        onEvent({
          type: "progress",
          jobId,
          phase: "walk",
          done: count,
          total: 0,
        }),
      signal,
    );

    if (signal?.aborted) return finishAborted();

    setPhase("hash");
    const synced = await syncFiles(
      db,
      core.rootId,
      discovered,
      (done, total) =>
        onEvent({ type: "progress", jobId, phase: "hash", done, total }),
      signal,
    );
    stats = synced.stats;
    const { identityTargets, moveConflicts } = synced;
    const ftsTargets = opts.rebuild
      ? (db
          .prepare(
            "SELECT id FROM files WHERE root_id = ? AND deleted_at IS NULL",
          )
          .pluck()
          .all(core.rootId) as number[])
      : synced.ftsTargets;

    if (signal?.aborted) return finishAborted();

    setPhase("identity");
    for (const conflict of moveConflicts) {
      recordMoveConflict(db, runId, conflict, nowUnix());
      identityStats.moveConflicts++;
      identityStats.issues++;
    }

    // Sync FTS only for new/moved/updated entries (unchanged ones need no re-sync).
    setPhase("index");
    const ftsTotal = ftsTargets.length;
    let done = 0;
    for (const id of ftsTargets) {
      if (signal?.aborted) break;
      syncFts(db, id);
      done++;
      if (done % 64 === 0 || done === ftsTotal) {
        onEvent({
          type: "progress",
          jobId,
          phase: "index",
          done,
          total: ftsTotal,
        });
        // Yield to the event loop every 256 entries.
        if (done % 256 === 0) await new Promise((r) => setImmediate(r));
      }
    }

    if (signal?.aborted) {
      return finishAborted();
    }

    // --- thumbnail/meta (parallel) ---
    setPhase("thumbnail");
    await clearNonVideoThumbnailPaths(db, core.thumbsDir());
    if (signal?.aborted) return finishAborted();
    const pending = q.filesNeedingThumb(db, core.rootId);
    const total = pending.length;
    let processed = 0;
    const thumbs = core.thumbsDir();
    const identityTargetsByFileId = new Map<number, IdentityTarget>(
      identityTargets.map((target) => [target.fileId, target]),
    );
    const identityAttemptedIds = new Set<number>();

    // Persist results in batches: one transaction per THUMB_FLUSH_EVERY files
    // instead of one implicit commit (+ FTS delete/insert) per file, which
    // multiplied WAL commits by the file count on a full scan. Progress and
    // thumbDone events are emitted per flush (after the commit, so the renderer's
    // thumbnail request sees thumb_status = 'done'), which also throttles the
    // previously per-file scan:progress IPC traffic.
    type ThumbResult = {
      id: number;
      kind: Kind;
      dest: string;
      ok: boolean;
      meta: Awaited<ReturnType<typeof extractMeta>>;
      preparedIdentity?: PreparedIdentity;
      identityError?: IdentityError;
      metadataError?: string;
      thumbnailError?: string;
      /** Set for media that intentionally has no generated thumbnail. Such rows
       *  still need their metadata persisted, but must land on thumb_status 'done'
       *  with a null path rather than staying pending forever. */
      skipThumb?: boolean;
    };
    const THUMB_FLUSH_EVERY = 32;
    let buffer: ThumbResult[] = [];

    const persistOne = (r: ThumbResult): void => {
      q.updateExtractedMeta(db, r.id, r.meta);
      identityAttemptedIds.add(r.id);
      if (r.identityError) {
        q.recordScanIssue(db, {
          runId,
          fileId: r.id,
          issueType: "fingerprint_failed",
          severity: "error",
          details: r.identityError,
          now: nowUnix(),
        });
        identityStats.issues++;
      } else if (r.preparedIdentity) {
        const row = db
          .prepare("SELECT video_id AS videoId FROM files WHERE id = ?")
          .get(r.id) as { videoId: string | null } | undefined;
        if (row?.videoId == null) {
          throw new Error(`file ${r.id} has no provisional video identity`);
        }
        const target = identityTargetsByFileId.get(r.id);
        const result = reconcileFileIdentity(db, {
          runId,
          fileId: r.id,
          currentVideoId: row.videoId,
          previousVideoId: target?.previousVideoId ?? null,
          fingerprint: r.preparedIdentity.fingerprint,
          metadata: r.preparedIdentity.metadata,
          now: nowUnix(),
          probeFailed: r.preparedIdentity.probeFailed,
        });
        identityStats.reconciled++;
        if (result.issueType) identityStats.issues++;
      }
      if (r.metadataError) {
        q.recordScanIssue(db, {
          runId,
          fileId: r.id,
          issueType: "probe_failed",
          severity: "error",
          details: { phase: "metadata", message: r.metadataError },
          now: nowUnix(),
        });
      }
      if (r.thumbnailError) {
        q.recordScanIssue(db, {
          runId,
          fileId: r.id,
          issueType: "thumbnail_failed",
          severity: "error",
          details: { phase: "thumbnail", message: r.thumbnailError },
          now: nowUnix(),
        });
      }
      if (r.skipThumb) {
        q.setThumb(db, r.id, null, "done");
      } else {
        q.setThumb(db, r.id, r.ok ? r.dest : null, r.ok ? "done" : "error");
      }
      const identity = db
        .prepare("SELECT video_id AS videoId FROM files WHERE id = ?")
        .get(r.id) as { videoId: string | null } | undefined;
      if (identity?.videoId) {
        queueDerivedAssets(db, { videoId: identity.videoId, kind: r.kind });
      }
      // Derive from what was just written, and before syncFts — which rebuilds
      // tags_text by re-reading meta_tags.
      applyAutoMetaTags(db, r.id, { kind: r.kind, ...r.meta });
      syncFts(db, r.id);
    };
    // Per-file transaction for the retry path: persistOne spans several writes
    // (incl. the FTS delete+insert), so a mid-way failure must roll back the
    // whole file rather than leave partial state (e.g. an FTS row deleted but
    // never re-inserted).
    const persistOneTx = db.transaction(persistOne);

    const flush = (): void => {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];
      const persisted: ThumbResult[] = [];
      try {
        db.transaction(() => {
          for (const r of batch) persistOne(r);
        })();
        persisted.push(...batch);
      } catch (e) {
        // A DB error (SQLITE_BUSY, disk full, constraint) rolls back the whole
        // batch; retry per file so one bad row can't discard its batchmates.
        // Files that still fail stay 'pending' and are retried next scan.
        log.warn("thumb/meta batch persist failed, retrying per file:", e);
        for (const r of batch) {
          try {
            persistOneTx(r);
            persisted.push(r);
          } catch (err) {
            log.warn(`failed to persist thumb/meta for file ${r.id}:`, err);
          }
        }
      }
      for (const r of persisted) {
        if (r.ok) onEvent({ type: "thumbDone", id: r.id });
      }
      // Only successfully persisted rows advance the progress counter — failed
      // rows stay 'pending' and are retried next scan (same as the old per-file
      // semantics, where a failed persist did not count as done).
      processed += persisted.length;
      onEvent({
        type: "progress",
        jobId,
        phase: "thumbnail",
        done: processed,
        total,
      });
    };

    // Per-file worker. Never throws: a pool worker that rejects would abandon
    // its siblings mid-flight (still writing to this DB after the scan has
    // reported as finished), so per-file failures are logged and the file is
    // left 'pending' for the next scan. Failures are counted so a tool that is
    // broken outright (every file failing) still surfaces as a scan error.
    let failed = 0;
    // Media without a generated thumbnail (images and successfully probed
    // audio) counts towards neither success nor failure of the tooling — it is
    // taken out of the denominator of the all-failed check below.
    let skipped = 0;
    const processOne = async (f: (typeof pending)[number]): Promise<void> => {
      if (signal?.aborted) return;
      const kind = f.kind as Kind;
      const dest = path.join(thumbs, `${f.id}.webp`);
      try {
        // ffprobe runs outside the decode slot: it doesn't decode, but it can be
        // slow on network shares and must not hold a decoder up meanwhile.
        let metadataError: string | undefined;
        let thumbnailError: string | undefined;
        const meta = await extractMeta(f.abs_path, kind, signal, (detail) => {
          metadataError = detail;
        });
        let preparedIdentity: PreparedIdentity | undefined;
        let identityError: IdentityError | undefined;
        try {
          preparedIdentity = await prepareIdentity(
            {
              id: f.id,
              absPath: f.abs_path,
              kind,
              size: f.size ?? 0,
            },
            meta,
            signal,
          );
        } catch (err) {
          if (signal?.aborted) return;
          identityError = describeIdentityError(err);
        }

        // Audio always needs its metadata (duration), but never gets a generated
        // thumbnail. A failed probe remains an error so it can be retried.
        if (kind === "audio") {
          if (signal?.aborted) return;
          // A failed probe (timeout, transient IO error, unparseable output)
          // yields `raw: null`, so the audio metadata is unknown.
          // Record it as 'error' — the same terminal state a video whose probe
          // failed lands in — rather than leaving it 'pending': a pending row is
          // re-probed on every scan (up to the 60 s ffprobe timeout each time)
          // and never counts towards the progress total. A later change to the
          // file resets it to 'pending' through syncFiles() like any other row.
          if (meta.raw == null) {
            failed++;
            buffer.push({
              id: f.id,
              kind,
              dest,
              ok: false,
              meta,
              preparedIdentity,
              identityError,
              metadataError,
            });
            if (buffer.length >= THUMB_FLUSH_EVERY) flush();
            return;
          }
          skipped++;
          buffer.push({
            id: f.id,
            kind,
            dest,
            ok: false,
            meta,
            preparedIdentity,
            identityError,
            metadataError,
            skipThumb: true,
          });
          if (buffer.length >= THUMB_FLUSH_EVERY) flush();
          return;
        }

        if (kind === "image") {
          skipped++;
          buffer.push({
            id: f.id,
            kind,
            dest,
            ok: false,
            meta,
            preparedIdentity,
            identityError,
            metadataError,
            skipThumb: true,
          });
          if (buffer.length >= THUMB_FLUSH_EVERY) flush();
          return;
        }

        // Honour a user-chosen thumbnail frame if one was set previously.
        const offsetSec = q.thumbOffsetOf(db, f.id) ?? undefined;
        const thumb = () =>
          generateThumb(
            f.abs_path,
            kind,
            dest,
            signal,
            offsetSec,
            undefined,
            (detail) => {
              thumbnailError = detail;
            },
          );
        // Video decodes are bounded process-wide together with the media
        // server's decodes. Images do not reach this branch.
        const ok = await withScanDecodeSlot(thumb, signal);

        // If aborted mid-flight, ffprobe/ffmpeg were killed and returned partial/empty
        // results. Don't persist them or mark the file 'error' (which filesNeedingThumb
        // skips on rescan) — leave it 'pending' so the next scan retries it.
        if (signal?.aborted) return;

        // ffmpeg reporting failure counts too, so a broken ffmpeg (every file
        // marked 'error') is caught by the all-failed check below.
        if (!ok) failed++;
        // Workers share the event loop, so buffering + flushing is race-free.
        buffer.push({
          id: f.id,
          kind,
          dest,
          ok,
          meta,
          preparedIdentity,
          identityError,
          metadataError,
          thumbnailError: ok
            ? undefined
            : (thumbnailError ?? "ffmpeg thumbnail generation failed"),
        });
        if (buffer.length >= THUMB_FLUSH_EVERY) flush();
      } catch (err) {
        if (signal?.aborted) return;
        failed++;
        log.warn(`thumbnail worker failed for ${f.id}:`, err);
        q.recordScanIssue(db, {
          runId,
          fileId: f.id,
          issueType: "thumbnail_worker_failed",
          severity: "error",
          details: { phase: "thumbnail", message: formatErrorDetail(err) },
          now: nowUnix(),
        });
      }
    };
    // Metadata-only media and videos run in separate pools: a run of videos
    // must not block the image/audio metadata side, and video decodes are
    // bounded process-wide inside processOne together with the media server's.
    // Both pools are awaited to completion regardless of failure, and whatever
    // completed is persisted before any failure propagates.
    const images = pending.filter((f) => f.kind !== "video");
    const videos = pending.filter((f) => f.kind === "video");
    try {
      const results = await Promise.allSettled([
        pool(images, SCAN_POOL_WIDTH, processOne, signal),
        pool(videos, SCAN_POOL_WIDTH, processOne, signal),
      ]);
      for (const r of results) if (r.status === "rejected") throw r.reason;
    } finally {
      // Persist the tail batch. On abort the buffered results are from ffmpeg
      // runs that completed before the signal fired, so they are safe to keep.
      flush();
    }

    if (signal?.aborted) return finishAborted();

    // Upgraded libraries can contain live rows with the stable bridge column but
    // no quick-v1 fingerprint yet. Converge those rows in the same run, using
    // stored probe data whenever it is available and probing at most once when
    // the legacy row has no raw metadata.
    setPhase("identity");
    const legacyRows = (
      db
        .prepare(
          "SELECT f.id, f.abs_path AS absPath, f.kind, f.size " +
            "FROM files f WHERE f.root_id = ? AND f.deleted_at IS NULL " +
            "AND f.video_id IS NOT NULL AND NOT EXISTS (" +
            "SELECT 1 FROM fingerprints fp WHERE fp.file_id = f.id " +
            "AND fp.algorithm = 'quick' AND fp.version = 'v1')",
        )
        .all(core.rootId) as Array<{
        id: number;
        absPath: string;
        kind: string;
        size: number | null;
      }>
    ).filter((row) => !identityAttemptedIds.has(row.id));

    await pool(
      legacyRows,
      SCAN_POOL_WIDTH,
      async (row): Promise<void> => {
        if (signal?.aborted) return;
        identityAttemptedIds.add(row.id);
        let metadata: ExtractedMeta;
        let prepared: PreparedIdentity;
        try {
          metadata = storedExtractedMeta(db, row.id);
          if (metadata.raw == null) {
            metadata = await extractMeta(row.absPath, row.kind as Kind, signal);
          }
          prepared = await prepareIdentity(
            {
              id: row.id,
              absPath: row.absPath,
              kind: row.kind as Kind,
              size: row.size ?? 0,
            },
            metadata,
            signal,
          );
        } catch (err) {
          if (signal?.aborted) return;
          const detail = describeIdentityError(err);
          q.recordScanIssue(db, {
            runId,
            fileId: row.id,
            issueType: "fingerprint_failed",
            severity: "error",
            details: detail,
            now: nowUnix(),
          });
          identityStats.issues++;
          return;
        }
        if (signal?.aborted) return;
        db.transaction(() => {
          q.updateExtractedMeta(db, row.id, metadata);
          const current = db
            .prepare("SELECT video_id AS videoId FROM files WHERE id = ?")
            .get(row.id) as { videoId: string | null } | undefined;
          if (current?.videoId == null) {
            throw new Error(`file ${row.id} has no provisional video identity`);
          }
          const target = identityTargetsByFileId.get(row.id);
          const result = reconcileFileIdentity(db, {
            runId,
            fileId: row.id,
            currentVideoId: current.videoId,
            previousVideoId: target?.previousVideoId ?? null,
            fingerprint: prepared.fingerprint,
            metadata: prepared.metadata,
            now: nowUnix(),
            probeFailed: prepared.probeFailed,
          });
          applyAutoMetaTags(db, row.id, {
            kind: row.kind,
            ...metadata,
          });
          const identity = db
            .prepare("SELECT video_id AS videoId FROM files WHERE id = ?")
            .get(row.id) as { videoId: string | null } | undefined;
          if (identity?.videoId) {
            queueDerivedAssets(db, {
              videoId: identity.videoId,
              kind: row.kind as Kind,
            });
          }
          syncFts(db, row.id);
          identityStats.reconciled++;
          if (result.issueType) identityStats.issues++;
        })();
      },
      signal,
    );

    if (signal?.aborted) return finishAborted();

    // Files classified as unchanged/moved never enter the pool above (syncFiles
    // leaves their thumb_status alone), so an existing library only gains derived
    // tags through this pass. It reads the ffprobe columns already on `files`, so
    // no media file is touched.
    setPhase("tags");
    if (!signal?.aborted && needsAutoMetaBackfill(db)) {
      await backfillAutoMetaTags(db, {
        signal,
        onProgress: (d, t) =>
          onEvent({
            type: "progress",
            jobId,
            phase: "tags",
            done: d,
            total: t,
          }),
      });
    }

    // Reclaim durable metadata whose file row no longer exists (mainly post-rebuild orphans).
    // Skipped on abort to avoid purging metadata for files not yet re-indexed (especially after rebuild).
    if (!signal?.aborted) q.pruneOrphanMeta(db);

    if (signal?.aborted) return finishAborted();

    if (signal?.aborted) return finishAborted();

    // Every file failing points at the tooling, not the files. Reported
    // regardless of batch size: a tiny incremental scan may flag a merely
    // corrupt file, but the alternative — a broken ffmpeg hiding behind small
    // scans and reporting success with zero thumbnails — is worse. Raised only
    // after the backfill/prune passes above, so a file that fails on every scan
    // cannot starve them indefinitely.
    const attempted = pending.length - skipped;
    if (failed > 0 && failed === attempted && !signal?.aborted) {
      throw new Error(
        `thumbnail extraction failed for all ${failed} attempted file(s) (is ffmpeg/ffprobe working?)`,
      );
    }

    setPhase("complete");
    q.touchScanRoot(db, core.rootId);
    finish("completed");
    onEvent({ type: "done", jobId, stats, aborted: signal?.aborted });
    return stats;
  } catch (error) {
    if (signal?.aborted) return finishAborted();
    const detail = error instanceof Error ? error.message : String(error);
    finish("failed", { code: "scan_failed", detail });
    throw error;
  }
}
