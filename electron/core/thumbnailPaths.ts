import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { DB } from "./db.js";

interface ThumbnailPathRow {
  id: number;
  thumbPath: string;
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/**
 * Remove thumbnail references for media that is not a video.
 *
 * Only the generated <id>.webp cache in the current workspace is removed from
 * disk. A stale path from an older portable location is cleared from SQLite,
 * but is never treated as a deletion target.
 */
export async function clearNonVideoThumbnailPaths(
  db: DB,
  thumbsDir: string,
): Promise<void> {
  const rows = db
    .prepare(
      "SELECT id, thumb_path AS thumbPath FROM files WHERE deleted_at IS NULL AND kind != 'video' AND thumb_path IS NOT NULL",
    )
    .all() as ThumbnailPathRow[];
  const clear = db.prepare(
    "UPDATE files SET thumb_path = NULL, thumb_status = 'done' WHERE id = ?",
  );
  const generatedPaths = rows
    .map((row) => ({
      row,
      expected: path.resolve(thumbsDir, `${row.id}.webp`),
    }))
    .filter(({ row, expected }) =>
      samePath(path.resolve(row.thumbPath), expected),
    )
    .map(({ expected }) => expected);

  db.transaction(() => {
    for (const row of rows) clear.run(row.id);
  })();

  await Promise.all(
    generatedPaths.map((filePath) =>
      fsp.rm(filePath, { force: true }).catch(() => undefined),
    ),
  );
}

/**
 * Reconcile cached thumbnail paths after a portable workspace is moved.
 *
 * Thumbnail paths are cached as absolute paths for fast serving. The cache
 * itself is portable, but an absolute path from the previous drive or release
 * directory is not. The file id is stable, so the current workspace cache is
 * the authoritative location for a thumbnail that still exists.
 */
export function repairThumbnailPaths(db: DB, thumbsDir: string): void {
  const rows = db
    .prepare(
      "SELECT id, thumb_path AS thumbPath FROM files WHERE thumb_path IS NOT NULL",
    )
    .all() as ThumbnailPathRow[];
  const rebase = db.prepare("UPDATE files SET thumb_path = ? WHERE id = ?");
  const reset = db.prepare(
    "UPDATE files SET thumb_path = NULL, thumb_status = 'pending' WHERE id = ?",
  );

  db.transaction(() => {
    for (const row of rows) {
      const currentPath = path.join(thumbsDir, `${row.id}.webp`);
      if (isRegularFile(currentPath)) {
        if (path.resolve(row.thumbPath) !== path.resolve(currentPath)) {
          rebase.run(currentPath, row.id);
        }
        continue;
      }

      if (!isRegularFile(row.thumbPath)) reset.run(row.id);
    }
  })();
}
