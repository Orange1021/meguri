import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import type { Core } from "./index.js";
import {
  ASSET_GENERATION_VERSIONS,
  assetAbsolutePath,
  assetRelativePath,
} from "./assets.js";
import { nowUnix, type DB } from "./db.js";
import {
  claimAssetTasks,
  completeAssetTask,
  enqueueAssetTask,
  failAssetTask,
  preferredAsset,
  recoverRunningAssetTasks as recoverRunningAssetTasksQuery,
  retireAsset,
  upsertAsset,
  type AssetRow,
} from "./queries/assets.js";
import { generateSheet, generateThumb } from "./media.js";
import type { Kind } from "./types.js";

const MAX_MANUAL_ASSET_BYTES = 100 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".webp", ".png", ".jpg", ".jpeg"]);
const assetTaskLocks = new WeakMap<object, Promise<void>>();

async function withAssetTaskLock<T>(
  db: DB,
  work: () => Promise<T>,
): Promise<T> {
  const previous = assetTaskLocks.get(db) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  assetTaskLocks.set(db, tail);

  await previous.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (assetTaskLocks.get(db) === tail) assetTaskLocks.delete(db);
  }
}

/** Create an FFmpeg temporary path while retaining its output extension. */
export function assetTemporaryPath(destination: string): string {
  return `${destination}.${randomUUID()}.tmp${path.extname(destination)}`;
}

/** Write an asset beside its final path and publish it with a rename. */
export async function atomicWriteAsset(
  assetRoot: string,
  relative: string,
  data: Uint8Array,
): Promise<string> {
  const destination = assetAbsolutePath(assetRoot, relative);
  if (!destination) throw new Error("unsafe asset path");
  const directory = path.dirname(destination);
  await fsPromises.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    const handle = await fsPromises.open(temporary, "w");
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await publishTemporaryFile(temporary, destination);
    return destination;
  } catch (error) {
    await fsPromises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readAssetFile(
  assetRoot: string,
  relative: string,
): Promise<Buffer> {
  const destination = assetAbsolutePath(assetRoot, relative);
  if (!destination) throw new Error("unsafe asset path");
  return fsPromises.readFile(destination);
}

async function publishTemporaryFile(
  temporary: string,
  destination: string,
): Promise<void> {
  try {
    await fsPromises.rename(temporary, destination);
  } catch (error) {
    // Windows can reject replacing an existing open file. Remove only the
    // validated destination and retry; the temporary file remains private until
    // the rename succeeds.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "EPERM") throw error;
    await fsPromises.rm(destination, { force: true });
    await fsPromises.rename(temporary, destination);
  }
}

async function atomicCopyAsset(
  assetRoot: string,
  relative: string,
  source: string,
): Promise<string> {
  const destination = assetAbsolutePath(assetRoot, relative);
  if (!destination) throw new Error("unsafe asset path");
  const directory = path.dirname(destination);
  await fsPromises.mkdir(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    await fsPromises.copyFile(source, temporary);
    await publishTemporaryFile(temporary, destination);
    return destination;
  } catch (error) {
    await fsPromises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** Import a user-selected picture and make it the durable manual Cover. */
export async function importManualCover(
  core: Core,
  videoId: string,
  sourcePath: string,
  now = nowUnix(),
): Promise<AssetRow> {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension))
    throw new Error("unsupported cover image");
  const stat = await fsPromises.stat(sourcePath);
  if (!stat.isFile() || stat.size > MAX_MANUAL_ASSET_BYTES) {
    throw new Error("cover image is too large or not a file");
  }
  const relative = assetRelativePath(
    videoId,
    "manual-original",
    extension.slice(1),
  );
  await atomicCopyAsset(core.assetsDir(), relative, sourcePath);
  const cover = assetRelativePath(videoId, "cover", extension.slice(1));
  // The cover points at the same copied bytes. Keeping a separate row for the
  // original makes the retention policy explicit without duplicating the file.
  dbTransaction(core.db, () => {
    upsertAsset(core.db, {
      videoId,
      kind: "manual-original",
      source: "manual",
      path: relative,
      generationVersion: ASSET_GENERATION_VERSIONS["manual-original"],
      now,
    });
    upsertAsset(core.db, {
      videoId,
      kind: "cover",
      source: "manual",
      path: cover,
      generationVersion: "manual-v1",
      now,
    });
  });
  // The cover row's path is intentionally a cover-shaped name. Publish a
  // second hard copy only when the source extension differs from the expected
  // asset path; this keeps the media route's kind-specific path predictable.
  if (cover !== relative)
    await atomicCopyAsset(core.assetsDir(), cover, sourcePath);
  return preferredAsset(core.db, videoId, "cover") as AssetRow;
}

export function restoreAutomaticCover(
  db: DB,
  videoId: string,
  now = nowUnix(),
): void {
  retireAsset(db, videoId, "cover", "manual", now);
  enqueueAssetTask(db, {
    videoId,
    kind: "cover",
    source: "auto",
    now,
  });
}

export function queueDerivedAssets(
  db: DB,
  input: { videoId: string; kind: Kind; now?: number },
): void {
  if (input.kind !== "video") return;
  const now = input.now ?? nowUnix();
  enqueueAssetTask(db, {
    videoId: input.videoId,
    kind: "cover",
    source: "auto",
    now,
  });
  if (input.kind === "video") {
    enqueueAssetTask(db, {
      videoId: input.videoId,
      kind: "sheet",
      source: "auto",
      now,
    });
  }
}

/** Requeue asset work left in progress by an interrupted process. */
export function recoverRunningAssetTasks(db: DB, now = nowUnix()): number {
  return recoverRunningAssetTasksQuery(db, now);
}

/** Recover interrupted work without racing another asset processor on this DB. */
export async function recoverRunningAssetTasksSafely(
  db: DB,
  now = nowUnix(),
): Promise<number> {
  return withAssetTaskLock(db, async () =>
    recoverRunningAssetTasksQuery(db, now),
  );
}

interface AssetFileRow {
  videoId: string;
  absPath: string;
  kind: Kind;
  duration: number | null;
  thumbPath: string | null;
}

function sidecarFor(file: AssetFileRow): string | null {
  const directory = path.dirname(file.absPath);
  const stem = path.basename(file.absPath, path.extname(file.absPath));
  const candidates = [
    ...["poster", "cover"].flatMap((name) =>
      [".webp", ".png", ".jpg", ".jpeg"].map((ext) =>
        path.join(directory, name + ext),
      ),
    ),
    ...[".webp", ".png", ".jpg", ".jpeg"].map((ext) =>
      path.join(directory, stem + ext),
    ),
  ];
  for (const candidate of candidates) {
    if (candidate.toLowerCase() === file.absPath.toLowerCase()) continue;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // A sidecar disappearing during a scan is treated as no sidecar.
    }
  }
  return null;
}

async function generateTask(
  core: Core,
  task: ReturnType<typeof claimAssetTasks>[number],
  file: AssetFileRow,
  signal?: AbortSignal,
): Promise<void> {
  if (file.kind !== "video") return;
  const sidecar = task.kind === "cover" ? sidecarFor(file) : null;
  if (sidecar) {
    const extension = path.extname(sidecar).slice(1).toLowerCase();
    const relative = assetRelativePath(file.videoId, "cover", extension);
    await atomicCopyAsset(core.assetsDir(), relative, sidecar);
    upsertAsset(core.db, {
      videoId: file.videoId,
      kind: "cover",
      source: "sidecar",
      path: relative,
      generationVersion: "sidecar-v1",
      now: nowUnix(),
    });
    return;
  }

  const extension = "webp";
  const kind = task.kind;
  const relative = assetRelativePath(file.videoId, kind, extension);
  const destination = assetAbsolutePath(core.assetsDir(), relative);
  if (!destination) throw new Error("unsafe generated asset path");
  const temporary = assetTemporaryPath(destination);
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  let ok = false;
  if (task.kind === "cover" && file.thumbPath) {
    const thumb = path.resolve(file.thumbPath);
    const relativeThumb = path.relative(core.thumbsDir(), thumb);
    const safeThumb = assetAbsolutePath(core.thumbsDir(), relativeThumb);
    if (safeThumb) {
      // A stale thumb_path is normal after a user deletes or moves a cache
      // file. Fall through to ffmpeg instead of leaving the asset task stuck
      // on a copy error.
      try {
        const stat = await fsPromises.stat(safeThumb);
        if (stat.isFile()) {
          await fsPromises.copyFile(safeThumb, temporary);
          ok = true;
        }
      } catch {
        // Generate a fresh cover below.
      }
    }
  }
  if (!ok && task.kind === "cover") {
    ok = await generateThumb(
      file.absPath,
      file.kind,
      temporary,
      signal,
      file.duration != null ? file.duration * 0.25 : undefined,
    );
  }
  if (!ok && task.kind === "sheet") {
    ok = await generateSheet(file.absPath, temporary, file.duration, signal);
  }
  if (!ok) throw new Error("asset generator produced no output");
  await publishTemporaryFile(temporary, destination);
  upsertAsset(core.db, {
    videoId: file.videoId,
    kind,
    source: task.source,
    path: relative,
    generationVersion: task.generationVersion,
    now: nowUnix(),
  });
}

export async function processPendingAssetTasks(
  core: Core,
  options: { signal?: AbortSignal; limit?: number; now?: number } = {},
): Promise<{ completed: number; failed: number }> {
  return withAssetTaskLock(core.db, () =>
    processPendingAssetTasksUnlocked(core, options),
  );
}

/** Process a claimed batch while the caller already owns the per-DB lock. */
async function processPendingAssetTasksUnlocked(
  core: Core,
  options: { signal?: AbortSignal; limit?: number; now?: number } = {},
): Promise<{ completed: number; failed: number }> {
  const now = options.now ?? nowUnix();
  const tasks = claimAssetTasks(core.db, now, options.limit ?? 4);
  let completed = 0;
  let failed = 0;
  for (const task of tasks) {
    if (options.signal?.aborted) break;
    const file = core.db
      .prepare(
        "SELECT video_id AS videoId, abs_path AS absPath, kind, duration, thumb_path AS thumbPath FROM files WHERE video_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1",
      )
      .get(task.videoId) as AssetFileRow | undefined;
    try {
      if (file) await generateTask(core, task, file, options.signal);
      completeAssetTask(core.db, task.taskId, nowUnix());
      completed++;
    } catch (error) {
      if (options.signal?.aborted) break;
      failAssetTask(
        core.db,
        task.taskId,
        nowUnix(),
        error instanceof Error ? error.message : String(error),
        task.attempts,
      );
      failed++;
    }
  }
  return { completed, failed };
}

/** Restore an automatic cover and process it without racing the background worker. */
export async function restoreAutomaticCoverAndProcess(
  core: Core,
  videoId: string,
  options: { limit?: number } = {},
): Promise<void> {
  await withAssetTaskLock(core.db, async () => {
    restoreAutomaticCover(core.db, videoId);
    await processPendingAssetTasksUnlocked(core, options);
  });
}

function dbTransaction(db: DB, work: () => void): void {
  db.transaction(work)();
}
