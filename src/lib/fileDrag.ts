// Dragging files from the media views onto a collection in the rail.
//
// The drag carries file identities only — `workspaceId + fileId` pairs, the
// same key every other membership write uses — under a MIME type of our own, so
// a drop target can tell an in-app file drag from anything else being dragged
// over the window (a folder from the OS, a link, selected text).
import type { FileRow } from "@/ipc/types";
import { MAX_BULK_FILES } from "@shared/tags";

/** dataTransfer type of an in-app file drag. Lowercase: browsers lowercase types. */
export const FILE_DRAG_MIME = "application/x-meguri-files";

export interface DraggedFile {
  workspaceId: string;
  fileId: number;
}

/**
 * Why a drag of a selected item cannot start: a selected folder's files are
 * still being fetched (the drag would silently leave them out), or the
 * selection is larger than one write may carry.
 */
export type DragRefusal = "pending" | "tooMany";

/**
 * What dragging `file` carries: the whole selection when the dragged item is
 * part of it, otherwise just that item — the way file managers behave, so
 * dragging an unselected item never silently takes the selection along.
 */
export function dragPayload(
  file: FileRow,
  selection: { rows: FileRow[]; count: number; pending: boolean },
  isSelected: boolean,
): DraggedFile[] | DragRefusal {
  if (!isSelected) return [{ workspaceId: file.workspaceId, fileId: file.id }];
  if (selection.pending) return "pending";
  // `count` rather than rows.length: a folder cut short at the cap counts all
  // of its files, which is exactly the case that must not go through partially.
  if (selection.count > MAX_BULK_FILES) return "tooMany";
  const rows = selection.rows.length > 0 ? selection.rows : [file];
  return rows.map((row) => ({ workspaceId: row.workspaceId, fileId: row.id }));
}

/** Whether a drag's types say it is an in-app file drag (readable during dragover). */
export function isFileDrag(types: readonly string[]): boolean {
  return types.includes(FILE_DRAG_MIME);
}

export function encodeFileDrag(files: DraggedFile[]): string {
  return JSON.stringify(files);
}

/**
 * Longest payload worth parsing: MAX_BULK_FILES entries with generous room for
 * each. Anything longer cannot be a valid drag and is refused unparsed.
 */
const MAX_PAYLOAD_LENGTH = MAX_BULK_FILES * 128;

/**
 * The files a drop carries, or null for anything that is not a well-formed
 * payload of at most MAX_BULK_FILES files. The data could come from another
 * window's drag, so it is checked rather than trusted; duplicates are dropped.
 */
export function decodeFileDrag(raw: string): DraggedFile[] | null {
  if (raw.length > MAX_PAYLOAD_LENGTH) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MAX_BULK_FILES
  ) {
    return null;
  }
  const seen = new Set<string>();
  const out: DraggedFile[] = [];
  for (const item of parsed) {
    const { workspaceId, fileId } = (item ?? {}) as Partial<DraggedFile>;
    if (typeof workspaceId !== "string" || workspaceId.length === 0) {
      return null;
    }
    if (typeof fileId !== "number" || !Number.isInteger(fileId) || fileId < 1) {
      return null;
    }
    const key = `${workspaceId}:${fileId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ workspaceId, fileId });
  }
  return out;
}
