// Multi-select state for the media list, shared by both view modes.
//
// Selection lives here rather than in each view because the views are swapped
// in and out as the user changes view mode and the selection has to survive
// that — and because the selection bar and the bulk tag dialog sit outside the
// views entirely.
//
// It is held in a small store that components subscribe to per value, rather
// than in React state on a context. With state on a context, every change
// produced a new context value, so each click re-rendered every mounted row —
// and a row holds a thumbnail, tag chips and three of its own controls, so a
// Shift range over a full viewport re-rendered all of that. A row now subscribes
// to its own boolean and React skips it when that boolean has not moved.
//
// A selected row is kept as a whole FileRow snapshot, not just its id, so a row
// that has scrolled out of the loaded window still counts: the bar's number and
// the dialog's totals can never drift apart. Reading a row prefers the version
// the list currently holds, so an edit landing in the query cache is reflected
// without the selection having to be told about it.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
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

/** The selection as a whole — what the bar and the dialog read. */
export interface SelectionView {
  /** Selection mode is on: cards show their checkbox and clicks select. */
  active: boolean;
  count: number;
  /** Selected rows, in the order they were selected. */
  rows: FileRow[];
}

export interface SelectionApi extends SelectionView {
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

const NO_ROWS: FileRow[] = [];
const EMPTY_VIEW: SelectionView = { active: false, count: 0, rows: NO_ROWS };

class SelectionStore {
  /** The list as currently loaded. Ranges and "select all" work on it. */
  private items: FileRow[] = [];
  private scope: string | null = null;
  private active = false;
  private selected = new Map<string, FileRow>();
  /**
   * Where a Shift-click measures its range from: the last row clicked without
   * Shift, held by key rather than by index. The list is a sliding window —
   * pages are dropped from one end as others load, and a new filter replaces it
   * outright — so an index kept across those would silently come to mean a
   * different file.
   */
  private anchorKey: string | null = null;
  private view: SelectionView = EMPTY_VIEW;
  private listeners = new Set<() => void>();
  /** A change made while rendering, announced once the commit is done. */
  private deferred = false;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable between changes, which is what lets subscribers bail out. */
  getView = (): SelectionView => this.view;

  isSelected = (file: FileRow): boolean =>
    this.selected.has(selectionKey(file));

  /** Read on its own, so entering or leaving selection mode is all a row sees. */
  isActive = (): boolean => this.active;

  /**
   * Called by the provider as it renders, so a list the user has just switched
   * to is never drawn carrying the previous list's selection.
   *
   * `scope` identifies which list `items` is. Changing it drops the selection:
   * rows picked under another workspace or another filter are no longer on
   * screen, and a bulk edit that silently included them would act on files the
   * user cannot see. Paging within one list must NOT change it.
   */
  syncList(items: FileRow[], scope: string): void {
    const listChanged = this.items !== items;
    this.items = items;
    if (this.scope !== scope) {
      const had = this.active || this.selected.size > 0;
      this.scope = scope;
      this.active = false;
      this.selected = new Map();
      this.anchorKey = null;
      if (had) this.rebuild(true);
      return;
    }
    // A selected row that is still loaded is read from the list, so an edit that
    // refreshed the query shows through the next time the selection is read.
    if (listChanged && this.selected.size > 0) this.rebuild(true);
  }

  /** Announces what syncList changed: notifying during render is not allowed. */
  flush = (): void => {
    if (!this.deferred) return;
    this.deferred = false;
    this.emit();
  };

  click = (file: FileRow, index: number, mods: SelectionClickMods): void => {
    const next = new Map(this.selected);
    const key = selectionKey(file);
    // The anchor is resolved against the list as it is now. If the row it named
    // has since been paged out, there is no meaningful range to draw and the
    // click falls back to picking this one row.
    const from = this.anchorKey
      ? this.items.findIndex((row) => selectionKey(row) === this.anchorKey)
      : -1;
    if (mods.shiftKey && from !== -1) {
      // A range always adds: dragging a selection out over rows already picked
      // should not punch holes in it. Shift also leaves the anchor where it is,
      // so a second Shift-click re-measures from the same start.
      const [lo, hi] = from <= index ? [from, index] : [index, from];
      for (const row of this.items.slice(lo, hi + 1)) {
        next.set(selectionKey(row), row);
      }
    } else {
      if (next.has(key)) next.delete(key);
      else next.set(key, file);
      this.anchorKey = key;
    }
    this.active = true;
    this.selected = next;
    this.rebuild(false);
  };

  // "All" is everything the list has loaded, not everything the filter matches:
  // the rows are what the tally and the edit are built from, so a count that
  // included rows the dialog cannot read would be a number the user cannot act
  // on. Scrolling further and pressing it again widens it.
  selectAll = (): void => {
    this.active = true;
    this.selected = new Map(
      this.items.map((row) => [selectionKey(row), row] as const),
    );
    this.anchorKey = null;
    this.rebuild(false);
  };

  deselectAll = (): void => {
    this.selected = new Map();
    this.anchorKey = null;
    this.rebuild(false);
  };

  exit = (): void => {
    this.active = false;
    this.selected = new Map();
    this.anchorKey = null;
    this.rebuild(false);
  };

  private rebuild(duringRender: boolean): void {
    if (this.selected.size === 0) {
      this.view = this.active
        ? { active: true, count: 0, rows: NO_ROWS }
        : EMPTY_VIEW;
    } else {
      const byKey = new Map(
        this.items.map((item) => [selectionKey(item), item] as const),
      );
      this.view = {
        active: this.active,
        count: this.selected.size,
        rows: [...this.selected].map(
          ([key, snapshot]) => byKey.get(key) ?? snapshot,
        ),
      };
    }
    if (duringRender) this.deferred = true;
    else this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

const StoreContext = createContext<SelectionStore | null>(null);

function useStore(): SelectionStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useSelection outside SelectionProvider");
  return store;
}

/** The selection as a whole. For the bar and the dialog, which show all of it. */
export function useSelection(): SelectionApi {
  const store = useStore();
  const view = useSyncExternalStore(store.subscribe, store.getView);
  return useMemo(
    () => ({
      ...view,
      isSelected: store.isSelected,
      click: store.click,
      selectAll: store.selectAll,
      deselectAll: store.deselectAll,
      exit: store.exit,
    }),
    [view, store],
  );
}

/**
 * One row's view of the selection: whether selection mode is on, and a reader
 * for its own membership.
 *
 * Both are subscribed as booleans rather than taken from {@link useSelection},
 * so a row re-renders only when its own membership moves. Entering or leaving
 * selection mode does re-render every row, which is the point: that is when the
 * checkboxes appear and disappear.
 */
export function useSelectionMode(): {
  active: boolean;
  click: SelectionApi["click"];
} {
  const store = useStore();
  const active = useSyncExternalStore(store.subscribe, store.isActive);
  return { active, click: store.click };
}

/** Whether this one row is selected, as its own subscription. */
export function useIsSelected(file: FileRow): boolean {
  const store = useStore();
  const read = () => store.isSelected(file);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function SelectionProvider({
  items,
  scope = "",
  children,
}: {
  /** The list as currently loaded. Range selection and "select all" work on it. */
  items: FileRow[];
  /** Identifies which list `items` is; see SelectionStore.syncList. */
  scope?: string;
  children: ReactNode;
}) {
  const [store] = useState(() => new SelectionStore());
  // Read while rendering so the views below never paint one frame with a
  // selection that belongs to the previous list; announced after the commit.
  store.syncList(items, scope);
  useEffect(() => store.flush());
  return (
    <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
  );
}
