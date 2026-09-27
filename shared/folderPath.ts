// A folder inside a workspace, as both processes name it: "/"-separated
// whatever the OS, with the workspace root as "". The database keeps
// `files.rel_path` in the OS's own separator (path.relative()), so the main
// process converts at the SQL boundary and nothing else ever splits on "\".

/** Longest folder path accepted over IPC. */
export const MAX_FOLDER_PATH = 4096;

/**
 * Most folders one folder_files call may expand. Here rather than beside the
 * channel schema so the renderer can batch by it without importing zod.
 */
export const MAX_FOLDER_FILES_PATHS = 1000;

/** The workspace root. */
export const ROOT_FOLDER = "";

/**
 * Whether `p` is a folder path in the normalized form: "" or segments joined
 * by single "/", none of them empty, "." or "..", and no NUL anywhere. The
 * path only ever becomes a bound SQL value, never a filesystem path, but a
 * malformed one could still address a range no real folder has.
 */
export function isNormalizedFolderPath(p: string): boolean {
  if (p === ROOT_FOLDER) return true;
  if (p.length > MAX_FOLDER_PATH || p.includes("\0")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** The path's segments, root first. The root itself has none. */
export function splitFolderPath(p: string): string[] {
  return p === ROOT_FOLDER ? [] : p.split("/");
}

/** The containing folder. The root is its own parent. */
export function parentOf(p: string): string {
  const at = p.lastIndexOf("/");
  return at === -1 ? ROOT_FOLDER : p.slice(0, at);
}

/** The child folder `name` inside `parent`. */
export function joinFolder(parent: string, name: string): string {
  return parent === ROOT_FOLDER ? name : `${parent}/${name}`;
}

/** The last segment: what the folder is called. "" for the root. */
export function folderNameOf(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}
