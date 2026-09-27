// What the file view is showing, for the status bar: how many files are shown
// and, while browsing a folder, how many folders sit beside them. Lives outside
// React for the same reason as useScanning: Home knows it, while the StatusBar
// that shows it is mounted in App, outside the router.
import { useSyncExternalStore } from "react";

export interface ListCounts {
  /**
   * Files shown. Null when the view shows the scope's whole library (nothing
   * narrows it), so the status bar can reuse the total it already has.
   */
  files: number | null;
  /** More files match than are loaded, so `files` is a lower bound. */
  more: boolean;
  /** Folders shown beside the files; null when not browsing by folder. */
  folders: number | null;
}

let value: ListCounts | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read once, outside React (tests, event handlers). */
export const getListCounts = (): ListCounts | null => value;

function same(a: ListCounts | null, b: ListCounts | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.files === b.files &&
      a.more === b.more &&
      a.folders === b.folders)
  );
}

/** Publish the counts (null: no file view mounted). Notifies only on change. */
export function setListCounts(next: ListCounts | null): void {
  if (same(value, next)) return;
  value = next;
  listeners.forEach((l) => l());
}

export function useListCounts(): ListCounts | null {
  return useSyncExternalStore(subscribe, getListCounts);
}
