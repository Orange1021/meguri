import fs from "node:fs";
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
