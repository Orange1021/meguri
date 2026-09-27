// The entries a file view draws when shown by folder: the folder's child
// folders first, then its files. Shared by MediaGrid and MediaList so the
// contract lives in one place:
//
// - Folders belong to the top of the list. A window that starts past the top
//   (listOffset > 0, earlier pages dropped) has scrolled them out with the
//   files before it: they are not drawn, and `leadingEntries` counts them
//   among the entries above the window, for the view's top padding.
// - Opening an entry opens a folder, or the file the way the view already
//   does (Enter plays, Shift+Enter inspects).
import { useCallback, useMemo } from "react";
import { useActivateFile } from "@/audio/useActivateFile";
import type { FileRow, FolderEntry } from "@/ipc/types";

export type FolderViewEntry =
  | { kind: "folder"; folder: FolderEntry }
  /** `fileIndex`: position in `items` — what selection ranges measure from. */
  | { kind: "file"; file: FileRow; fileIndex: number };

export function useFolderEntries({
  items,
  folders,
  listOffset,
  onOpenFolder,
}: {
  items: FileRow[];
  folders: FolderEntry[] | undefined;
  listOffset: number;
  onOpenFolder: ((path: string) => void) | undefined;
}): {
  entries: FolderViewEntry[];
  /** Entries above the loaded window (for the view's top padding). */
  leadingEntries: number;
  /** Keyboard Enter: a folder opens, a file plays. */
  onOpen: (index: number) => void;
  /** Keyboard Shift+Enter: a folder opens, a file opens paused. */
  onInspect: (index: number) => void;
} {
  const { activate } = useActivateFile();
  const entries = useMemo<FolderViewEntry[]>(
    () => [
      ...(listOffset === 0 ? (folders ?? []) : []).map((folder) => ({
        kind: "folder" as const,
        folder,
      })),
      ...items.map((file, fileIndex) => ({
        kind: "file" as const,
        file,
        fileIndex,
      })),
    ],
    [folders, items, listOffset],
  );
  const leadingEntries =
    listOffset > 0 ? (folders?.length ?? 0) + listOffset : 0;

  const onOpen = useCallback(
    (index: number) => {
      const e = entries[index];
      if (e?.kind === "folder") onOpenFolder?.(e.folder.path);
      else if (e) activate(e.file);
    },
    [entries, activate, onOpenFolder],
  );
  const onInspect = useCallback(
    (index: number) => {
      const e = entries[index];
      if (e?.kind === "folder") onOpenFolder?.(e.folder.path);
      else if (e) activate(e.file, { autoplay: false });
    },
    [entries, activate, onOpenFolder],
  );
  return { entries, leadingEntries, onOpen, onInspect };
}
