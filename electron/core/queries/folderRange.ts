// Where a folder's files sit in `files.rel_path`. Kept free of other query
// imports so both files.ts (the folder filter on search) and folders.ts (the
// folder listing) can use it without importing each other.
//
// A folder is not stored anywhere: "under Movie" is the half-open range
// ["Movie/", "Movie0") — "0" being the code point right after "/". Ending the
// prefix at the separator is what keeps a sibling like "Movies" out, and a
// range (unlike LIKE) needs no escaping of "%"/"_" and stays on the rel_path
// index. SQLite compares TEXT as UTF-8 bytes (BINARY), so every string that
// starts with the prefix falls inside the range and nothing else does.
import path from "node:path";

/**
 * `files f` pinned to the rel_path index. Workspace DBs are never ANALYZEd,
 * and without statistics SQLite prefers the equality-looking
 * "deleted_at IS NULL" on idx_files_alive (or another indexed equality, or the
 * index of the sort) over a folder's range: a walk over every live file in the
 * library. Pinning keeps a folder-scoped query on its own slice. Only for
 * ranged queries: the root has no range to walk.
 */
export const PINNED_FILES = "files f INDEXED BY idx_files_alive_rel_path";
/** FILE_FROM (queries/files.ts) over the pinned index, same aliases. */
export const FOLDER_FILE_FROM = `FROM ${PINNED_FILES} LEFT JOIN file_meta m ON m.meta_key = f.meta_key`;

export interface FolderRange {
  /** "Movie/2024/" in the native separator; "" for the root. */
  prefix: string;
  /** Exclusive upper bound of the range; null for the root (no bound). */
  upper: string | null;
  /**
   * 1-based start of the part of rel_path below the folder, for SQL substr().
   * Counted in code points, as SQLite's substr/instr count characters — a
   * UTF-16 length would be off by one per astral character (emoji) in the path.
   */
  start: number;
  sep: string;
}

/**
 * The rel_path range of a normalized folder path ("/"-separated, "" = root).
 * `sep` is the separator the database was written with: the running OS's, as
 * rel_path comes from path.relative(). Injectable so tests cover Windows.
 */
export function folderRange(
  folder: string,
  sep: string = path.sep,
): FolderRange {
  if (folder === "") return { prefix: "", upper: null, start: 1, sep };
  // On Windows "\\" inside a segment would alias "a\\b" to "a/b". No real
  // folder name contains the OS separator, so such a path names nothing.
  if (sep !== "/" && folder.includes(sep)) {
    throw new Error("folder path contains the native separator");
  }
  const prefix = `${folder.split("/").join(sep)}${sep}`;
  const upper =
    prefix.slice(0, -1) + String.fromCharCode(sep.charCodeAt(0) + 1);
  return { prefix, upper, start: [...prefix].length + 1, sep };
}

/**
 * SQL (on the `f` alias) restricting rows to a folder: everything under it, or
 * with `recursive: false` only its direct files. Values are bound, never
 * spliced into the SQL.
 */
export function folderCondition(
  range: FolderRange,
  recursive: boolean,
): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (range.upper != null) {
    parts.push("f.rel_path >= ? AND f.rel_path < ?");
    args.push(range.prefix, range.upper);
  }
  if (!recursive) {
    // No separator left below the folder: a direct child.
    parts.push(
      range.start === 1
        ? "instr(f.rel_path, ?) = 0"
        : "instr(substr(f.rel_path, ?), ?) = 0",
    );
    if (range.start !== 1) args.push(range.start);
    args.push(range.sep);
  }
  return { sql: parts.join(" AND "), args };
}
