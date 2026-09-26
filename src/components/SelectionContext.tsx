// Multi-select state for the media list, shared by all three view modes.
//
// Selection lives here rather than in each view because the views are swapped
// in and out as the user changes view mode and the selection has to survive
// that — and because the selection bar and the bulk tag dialog sit outside the
// views entirely.
//
// A selected row is kept as a whole FileRow snapshot, not just its id, so a row
// that has scrolled out of the loaded window still counts: the bar's number and
// the dialog's totals can never drift apart. Reading a row prefers the version
// the list currently holds, so an edit landing in the query cache is reflected
// without the selection having to be told about it.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FileRow } from "@/ipc/types";
// The same identity drag-and-drop keys rows by: file ids are unique only
// within a workspace.
import { mediaSortId as selectionKey } from "@/lib/mediaSortId";

/** Modifier keys that change what a click on a card means. */
export interface SelectionClickMods {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface SelectionApi {
  /** Selection mode is on: cards show their checkbox and clicks select. */
  active: boolean;
  count: number;
  /** Selected rows, in the order they were selected. */
  rows: FileRow[];
  isSelected: (file: FileRow) => boolean;
  /** A click on a card while selecting, or a modified click that starts it. */
  click: (file: FileRow, index: number, mods: SelectionClickMods) => void;
  /** Every loaded row. "Loaded" is the honest scope; see the comment on it. */
  selectAll: () => void;
  /** Empty the selection but stay in selection mode. */
  deselectAll: () => void;
  /** Leave selection mode and drop everything. */
  exit: () => void;
}

const SelectionContext = createContext<SelectionApi | null>(null);

export function useSelection(): SelectionApi {
  const api = useContext(SelectionContext);
  if (!api) throw new Error("useSelection outside SelectionProvider");
  return api;
}

/**
 * Whether a click should be treated as a selection click at all. Used by the
 * views to decide whether to swallow a card's navigation: in selection mode
 * every plain click selects, and outside it only a modified click does — which
 * is what lets a selection start without first aiming at the checkbox.
 */
export function isSelectionClick(
  active: boolean,
  mods: SelectionClickMods,
): boolean {
  return active || mods.shiftKey || mods.ctrlKey || mods.metaKey;
}

interface State {
  active: boolean;
  selected: Map<string, FileRow>;
  /**
   * Where a Shift-click measures its range from: the last row clicked without
   * Shift, held by key rather than by index. The list is a sliding window —
   * pages are dropped from one end as others load, and a new filter replaces it
   * outright — so an index kept across those would silently come to mean a
   * different file.
   */
  anchorKey: string | null;
  /** The list this selection was built against; see the reset below. */
  scope: string;
}

const EMPTY: Omit<State, "scope"> = {
  active: false,
  selected: new Map(),
  anchorKey: null,
};
// Stable identity so a selection-free list does not hand every card a new array
// (and with it a new context value) each time the query cache moves.
const NO_ROWS: FileRow[] = [];

export function SelectionProvider({
  items,
  scope = "",
  children,
}: {
  /** The list as currently loaded. Range selection and "select all" work on it. */
  items: FileRow[];
  /**
   * Identifies which list `items` is. Changing it drops the selection: rows
   * picked under another workspace or another filter are no longer on screen,
   * and a bulk edit that silently included them would act on files the user
   * cannot see. Paging within one list must NOT change this.
   */
  scope?: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ ...EMPTY, scope });

  // Adjusting state during render, rather than in an effect, so the views below
  // never paint one frame with a selection that belongs to the previous list.
  if (state.scope !== scope) {
    setState({ ...EMPTY, scope });
  }

  const { active, selected } = state;

  const isSelected = useCallback(
    (file: FileRow) => selected.has(selectionKey(file)),
    [selected],
  );

  const click = useCallback(
    (file: FileRow, index: number, mods: SelectionClickMods) => {
      setState((prev) => {
        const next = new Map(prev.selected);
        const key = selectionKey(file);
        // The anchor is resolved against the list as it is now. If the row it
        // named has since been paged out, there is no meaningful range to draw
        // and the click falls back to picking this one row.
        const from = prev.anchorKey
          ? items.findIndex((row) => selectionKey(row) === prev.anchorKey)
          : -1;
        if (mods.shiftKey && from !== -1) {
          // A range always adds: dragging a selection out over rows already
          // picked should not punch holes in it.
          const [lo, hi] = from <= index ? [from, index] : [index, from];
          for (const row of items.slice(lo, hi + 1)) {
            next.set(selectionKey(row), row);
          }
          // Shift extends from the existing anchor and leaves it where it is,
          // so a second Shift-click re-measures from the same start.
          return { ...prev, active: true, selected: next };
        }
        if (next.has(key)) next.delete(key);
        else next.set(key, file);
        return { ...prev, active: true, selected: next, anchorKey: key };
      });
    },
    [items],
  );

  // "All" is everything the list has loaded, not everything the filter matches:
  // the rows are what the tally and the edit are built from, so a count that
  // included rows the dialog cannot read would be a number the user cannot act
  // on. Scrolling further and pressing it again widens it.
  const selectAll = useCallback(() => {
    setState((prev) => ({
      ...prev,
      active: true,
      selected: new Map(items.map((row) => [selectionKey(row), row])),
      anchorKey: null,
    }));
  }, [items]);

  const deselectAll = useCallback(() => {
    setState((prev) => ({ ...prev, selected: new Map(), anchorKey: null }));
  }, []);

  const exit = useCallback(() => {
    setState((prev) => ({ ...EMPTY, scope: prev.scope }));
  }, []);

  // The snapshot is the fallback, not the source: a selected row still in the
  // list is read from the list, so a tag edit that refreshed the query is
  // already visible the next time the selection is read. Nothing selected means
  // no work at all — this runs on every query-cache change.
  const rows = useMemo(() => {
    if (selected.size === 0) return NO_ROWS;
    const byKey = new Map(items.map((item) => [selectionKey(item), item]));
    return [...selected].map(([key, snapshot]) => byKey.get(key) ?? snapshot);
  }, [selected, items]);

  const api = useMemo<SelectionApi>(
    () => ({
      active,
      count: rows.length,
      rows,
      isSelected,
      click,
      selectAll,
      deselectAll,
      exit,
    }),
    [active, rows, isSelected, click, selectAll, deselectAll, exit],
  );

  return (
    <SelectionContext.Provider value={api}>
      {children}
    </SelectionContext.Provider>
  );
}
