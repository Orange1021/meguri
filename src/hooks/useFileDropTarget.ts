// Makes a rail entry a drop target for files dragged out of the media views.
import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import {
  decodeFileDrag,
  FILE_DRAG_MIME,
  isFileDrag,
  type DraggedFile,
} from "@/lib/fileDrag";

export interface FileDropTarget {
  /** A file drag is over the target: drives its highlight. */
  over: boolean;
  handlers: {
    onDragEnter: (e: ReactDragEvent) => void;
    onDragOver: (e: ReactDragEvent) => void;
    onDragLeave: (e: ReactDragEvent) => void;
    onDrop: (e: ReactDragEvent) => void;
  };
}

export function useFileDropTarget(
  onDropFiles: (files: DraggedFile[]) => void,
): FileDropTarget {
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child the pointer crosses, so a plain
  // boolean would flicker off while moving from the button onto its icon.
  const depth = useRef(0);
  // Anything else being dragged (a folder from the OS, text) is ignored here,
  // so it falls through to the window-level folder drop.
  const accepts = (e: ReactDragEvent) => isFileDrag(e.dataTransfer.types);
  return {
    over,
    handlers: {
      onDragEnter: (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current += 1;
        setOver(true);
      },
      onDragOver: (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: (e) => {
        if (!accepts(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop: (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const files = decodeFileDrag(e.dataTransfer.getData(FILE_DRAG_MIME));
        if (files) onDropFiles(files);
      },
    },
  };
}
