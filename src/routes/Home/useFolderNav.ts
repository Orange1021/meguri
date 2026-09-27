// Where the folder view is, per workspace, and how it got there.
//
// Held in memory rather than in the URL: the detail, settings and other
// screens are child routes drawn over Home, which stays mounted underneath, so
// state kept here survives opening and closing them untouched — while a
// "?folder=" on "/" would be dropped by the first navigate to "/file/:id".
// Nothing needs it across a restart (the view opens at the workspace root).
import { useCallback, useMemo, useState } from "react";
import { ROOT_FOLDER, parentOf } from "@shared/folderPath";

/** How many steps "back" remembers per workspace. */
export const FOLDER_BACK_LIMIT = 100;

interface Entry {
  path: string;
  /** Earlier locations, most recent last. */
  back: string[];
}

const START: Entry = { path: ROOT_FOLDER, back: [] };

export interface FolderNav {
  /** The folder being shown ("" is the workspace root). */
  path: string;
  canGoBack: boolean;
  /** Open a child folder (or any folder): remembered for "back". */
  enter: (path: string) => void;
  /** Jump to a folder, e.g. from the breadcrumb: remembered for "back". */
  goTo: (path: string) => void;
  /** Return to where the previous move started from. */
  goBack: () => void;
  /** One level up. Does nothing at the root. */
  goUp: () => void;
  /**
   * Swap the location without a history step: the folder shown is gone and
   * the main process resolved its nearest remaining ancestor.
   */
  replace: (path: string) => void;
}

export function useFolderNav(
  workspaceId: string | null | undefined,
): FolderNav {
  const [byWorkspace, setByWorkspace] = useState<Record<string, Entry>>({});
  const key = workspaceId ?? "";
  const entry = byWorkspace[key] ?? START;

  const update = useCallback(
    (fn: (e: Entry) => Entry) =>
      setByWorkspace((all) => {
        const current = all[key] ?? START;
        const next = fn(current);
        return next === current ? all : { ...all, [key]: next };
      }),
    [key],
  );

  const move = useCallback(
    (path: string) =>
      update((e) =>
        e.path === path
          ? e
          : {
              path,
              back: [...e.back, e.path].slice(-FOLDER_BACK_LIMIT),
            },
      ),
    [update],
  );

  const goBack = useCallback(
    () =>
      update((e) =>
        e.back.length === 0
          ? e
          : { path: e.back[e.back.length - 1], back: e.back.slice(0, -1) },
      ),
    [update],
  );

  const goUp = useCallback(
    () =>
      update((e) =>
        e.path === ROOT_FOLDER
          ? e
          : {
              path: parentOf(e.path),
              back: [...e.back, e.path].slice(-FOLDER_BACK_LIMIT),
            },
      ),
    [update],
  );

  const replace = useCallback(
    (path: string) => update((e) => (e.path === path ? e : { ...e, path })),
    [update],
  );

  return useMemo(
    () => ({
      path: entry.path,
      canGoBack: entry.back.length > 0,
      enter: move,
      goTo: move,
      goBack,
      goUp,
      replace,
    }),
    [entry, move, goBack, goUp, replace],
  );
}
