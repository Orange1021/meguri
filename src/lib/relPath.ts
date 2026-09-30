// `relPath` comes from the main process via path.relative(), so its separator
// is platform-dependent: "/" on Linux/macOS, "\" on Windows. Split on both.
export function fileNameOf(relPath: string): string {
  return relPath.split(/[\\/]/).pop() || relPath;
}

/** The folder part of a relative path, "" for a file at the workspace root. */
export function dirOf(relPath: string): string {
  const i = Math.max(relPath.lastIndexOf("/"), relPath.lastIndexOf("\\"));
  return i < 0 ? "" : relPath.slice(0, i);
}

/**
 * The folder holding a file, in the "/"-separated form the folder view names
 * folders by (shared/folderPath.ts): "" for a file at the workspace root.
 */
export function folderPathOf(relPath: string): string {
  return dirOf(relPath).split(/[\\/]/).join("/");
}
