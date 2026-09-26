// What a click on a media card means while a selection is being built, shared
// by MediaGrid, MediaList and MediaTable so the three cannot drift — the same
// reason useActivateFile exists for the open/play gesture beside it.
//
// The rule: in selection mode every plain click picks the row; outside it only
// a modified click does, which is what lets a selection start without first
// aiming at the checkbox.
import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { isSelectionClick, useSelection } from "@/components/SelectionContext";
import type { FileRow } from "@/ipc/types";

export interface SelectableClick {
  /** Whether this row is in the selection (drives the card's own styling). */
  selected: boolean;
  /**
   * Call from the card's click handler. Returns true when the click was taken
   * as a selection, in which case the caller must not navigate or open.
   */
  onSelectableClick: (e: ReactMouseEvent) => boolean;
}

export function useSelectableClick(
  file: FileRow,
  /** Position in the loaded list — what a Shift-click ranges from. */
  index: number,
): SelectableClick {
  const selection = useSelection();
  const onSelectableClick = useCallback(
    (e: ReactMouseEvent) => {
      if (!isSelectionClick(selection.active, e)) return false;
      e.preventDefault();
      e.stopPropagation();
      selection.click(file, index, e);
      return true;
    },
    [selection, file, index],
  );
  return { selected: selection.isSelected(file), onSelectableClick };
}
