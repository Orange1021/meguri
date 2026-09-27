// Resolve the storage location for artifacts (DB and thumbnails).
// Centralized under the app userData directory, with one hashed folder per scan root.
import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The app's base data directory. Uses Electron's userData. */
export function baseDataDir(): string {
  // e.g. Linux ~/.config/Meguri → unified under userData here.
  return app.getPath("userData");
}

/** Stable hash of a scan root path (hex). */
export function pathHash(p: string): string {
  return createHash("sha1").update(p).digest("hex").slice(0, 16);
}

/** The artifacts directory corresponding to a root. */
export function dataDirForRoot(root: string): string {
  return path.join(baseDataDir(), "roots", pathHash(root));
}

/** The SQLite file inside a root's data directory. */
export function dbPathForDataDir(dataDir: string): string {
  return path.join(dataDir, "db.sqlite");
}

/**
 * Whether an absolute path lies inside (or is equal to) a normalized root directory.
 * Plain `abs.startsWith(root)` would let "/home/u/videos2/x" match root "/home/u/videos".
 * Symlinks are resolved so a path under root that points outside is rejected.
 * Drive-root edge case ("C:\\") already ends with a separator, so don't double up.
 */
export function isInsideRoot(abs: string, root: string): boolean {
  let normalizedAbs: string;
  let normalizedRoot: string;
  try {
    normalizedAbs = fs.realpathSync(abs);
    normalizedRoot = fs.realpathSync(root);
  } catch {
    return false;
  }
  // Windows filesystems are case-insensitive, so a drive-letter or folder
  // casing mismatch between the DB path and the configured root must not
  // reject a file that is genuinely inside the root.
  if (process.platform === "win32") {
    normalizedAbs = normalizedAbs.toLowerCase();
    normalizedRoot = normalizedRoot.toLowerCase();
  }
  if (normalizedAbs === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  return normalizedAbs.startsWith(prefix);
}

/**
 * A workspace folder — "/"-separated relative to `root`, "" for the root
 * itself — as the canonical (symlinks resolved) path of an existing directory
 * inside `root`, or null when there is none: gone since the last scan, a
 * file, or a link that leads outside the root.
 *
 * The canonical path is what gets returned (and opened), so the directory
 * checked is the one handed to the OS, not a name that could be re-pointed in
 * between. On Windows a segment may not carry "\\" or ":" — both are "/"-free,
 * so the "/"-only folder syntax would pass them, yet path.join would read them
 * as separators or a drive/stream. `sep` is injectable for tests.
 */
export function folderDirInsideRoot(
  root: string,
  folder: string,
  sep: string = path.sep,
): string | null {
  const segments = folder === "" ? [] : folder.split("/");
  if (sep === "\\" && segments.some((s) => /[\\:]/.test(s))) return null;
  let real: string;
  try {
    real = fs.realpathSync(path.join(root, ...segments));
  } catch {
    return null;
  }
  if (!isInsideRoot(real, root)) return null;
  try {
    return fs.statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}
