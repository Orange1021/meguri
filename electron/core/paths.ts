// Resolve the storage location for artifacts (DB and thumbnails).
// Centralized under the resolved portable Data directory, with one folder per
// persisted workspace identity.
import { app } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { PortableLayout } from "./portablePaths.js";

/** The app's base data directory. Uses Electron's userData only for legacy/test callers. */
export function baseDataDir(
  layout?: Pick<PortableLayout, "dataDir">,
): string {
  // e.g. Linux ~/.config/Meguri → unified under userData here.
  return layout?.dataDir ?? app.getPath("userData");
}

/** Stable hash of a scan root path (hex). */
export function pathHash(p: string): string {
  return createHash("sha1").update(p).digest("hex").slice(0, 16);
}

/** The artifacts directory corresponding to a root. */
export function dataDirForRoot(
  root: string,
  dataRoot?: string | Pick<PortableLayout, "dataDir">,
  workspaceId?: string,
): string {
  const base = typeof dataRoot === "string" ? dataRoot : baseDataDir(dataRoot);
  return path.join(base, "roots", workspaceId ?? pathHash(root));
}

/** The artifacts directory for a persisted workspace identity. */
export function dataDirForWorkspaceId(
  workspaceId: string,
  dataRoot?: string | Pick<PortableLayout, "dataDir">,
): string {
  const base = typeof dataRoot === "string" ? dataRoot : baseDataDir(dataRoot);
  return path.join(base, "roots", workspaceId);
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
 * itself — as a path under `root` spelled the way the user knows it (the
 * root as configured, links not resolved). Not checked: pair it with
 * folderDirInsideRoot before it leaves the process.
 */
export function folderPathUnderRoot(root: string, folder: string): string {
  return folder === "" ? root : path.join(root, ...folder.split("/"));
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
    real = fs.realpathSync(folderPathUnderRoot(root, folder));
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

/**
 * A folder dropped onto the window, accepted only if it is an existing
 * directory given as an absolute path; anything else yields null.
 *
 * The path is resolved in the preload from a dropped File, but the channel is
 * still an input from outside main: a dropped regular file, a folder deleted
 * since the drop, or an empty string (what the preload gets for a File that did
 * not come from the filesystem) must not be registered as a workspace. stat
 * follows symlinks, so a link to a directory counts as one, and the link is
 * resolved to the directory it points at.
 */
// The JS realpath, not fs.promises.realpath (which has fs.realpath.native's
// semantics): registration normalizes with fs.realpathSync, and the two must
// agree. Native resolution expands mapped drives to UNC paths and 8.3 names on
// Windows, which would register the same folder under a second id.
const realpathJs = promisify(fs.realpath);

export async function droppedDirectory(p: string): Promise<string | null> {
  if (!p || !path.isAbsolute(p)) return null;
  // Async, and the canonical path is what is returned: a folder on an
  // unresponsive network mount must not stall main here, and registering an
  // already-resolved path keeps the synchronous realpath that registration
  // does (normalizeDir) from being the first to touch the mount.
  try {
    if (!(await fs.promises.stat(p)).isDirectory()) return null;
    return await realpathJs(p);
  } catch {
    return null;
  }
}
