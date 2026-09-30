// Folders dropped onto the window from the OS become workspaces.
//
// Listens on the window, so a folder can be dropped anywhere, and reports
// whether an OS drag is over the window so a full-window drop zone can show.
// Only the File objects reach the caller: their paths are resolved in the
// preload (webUtils.getPathForFile), never here.
import { useEffect, useRef, useState } from "react";
import { isFileDrag } from "@/lib/fileDrag";

export interface DroppedItems {
  /** Dropped folders, as the File objects the preload resolves paths from. */
  dirs: File[];
  /** How many dropped entries were not folders (files, or unreadable). */
  others: number;
}

/**
 * Split a drop into folders and everything else. Must run synchronously inside
 * the drop event: the item list is emptied once the handler returns.
 */
export function splitDroppedItems(
  items: ArrayLike<
    Pick<DataTransferItem, "kind" | "getAsFile" | "webkitGetAsEntry">
  >,
): DroppedItems {
  const dirs: File[] = [];
  let others = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry();
    const file = item.getAsFile();
    if (entry?.isDirectory && file) dirs.push(file);
    else others += 1;
  }
  return { dirs, others };
}

/**
 * Whether a drag comes from the OS. A drag started inside the app (a card, an
 * image) can also report "Files" — Chromium adds one for a dragged image — so
 * those are excluded by remembering that a dragstart happened in the document.
 */
function hasOsFiles(e: DragEvent, internal: boolean): boolean {
  const types = e.dataTransfer?.types ?? [];
  return !internal && !isFileDrag(types) && types.includes("Files");
}

export function useOsFolderDrop(onDrop: (items: DroppedItems) => void): {
  active: boolean;
} {
  const [active, setActive] = useState(false);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  useEffect(() => {
    let internal = false;
    let depth = 0;
    const reset = () => {
      depth = 0;
      setActive(false);
    };
    const onDragStart = () => {
      internal = true;
    };
    // dragend is the normal way an in-app drag ends. It does not reach the
    // document when the source row was unmounted mid-drag (the list is
    // virtualized), so the first pointer move after any drag also clears it:
    // no mousemove is delivered while a drag is in progress.
    const onInternalEnd = () => {
      internal = false;
    };
    const onEnter = (e: DragEvent) => {
      if (!hasOsFiles(e, internal)) return;
      e.preventDefault();
      depth += 1;
      setActive(true);
    };
    // dragover and drop are cancelled for every drag, not just folders from
    // the OS: a drop the page leaves alone is "opened" by Chromium, i.e. the
    // window navigates to the dropped file. A drop target further down (a
    // collection in the rail) has already cancelled it and set its own effect.
    const onOver = (e: DragEvent) => {
      const handled = e.defaultPrevented;
      e.preventDefault();
      if (handled || !e.dataTransfer) return;
      e.dataTransfer.dropEffect = hasOsFiles(e, internal) ? "copy" : "none";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasOsFiles(e, internal)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDropEvent = (e: DragEvent) => {
      e.preventDefault();
      const fromOs = hasOsFiles(e, internal);
      // Any drop ends whatever drag was in progress, in-app or not.
      internal = false;
      if (!fromOs) return;
      reset();
      const dropped = splitDroppedItems(e.dataTransfer?.items ?? []);
      if (dropped.dirs.length > 0 || dropped.others > 0) {
        onDropRef.current(dropped);
      }
    };
    document.addEventListener("dragstart", onDragStart);
    document.addEventListener("dragend", onInternalEnd);
    window.addEventListener("mousemove", onInternalEnd);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDropEvent);
    return () => {
      document.removeEventListener("dragstart", onDragStart);
      document.removeEventListener("dragend", onInternalEnd);
      window.removeEventListener("mousemove", onInternalEnd);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDropEvent);
    };
  }, []);

  return { active };
}
