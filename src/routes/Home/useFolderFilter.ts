// The folder browsed, read back as one more condition of the filter bar.
//
// `filter` never holds the folder: useFolderNav owns where the view is. The
// bar is handed the two combined — below a workspace's root the folder gets a
// chip of its own and a saved search carries it — and what comes back is split
// apart again: the folder moves the view, the rest is `filter`. Also where a
// folder is opened from outside the list (a file's detail, a saved search),
// switching to its workspace first when another one is shown.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import type { AppStatus, SearchQuery, WorkspacesList } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { onShowFolderInLibrary } from "@/lib/ui-events";
import type { SmartCollection } from "@/lib/smartCollections";
import { invalidateWorkspaceScoped } from "@/lib/workspaceScope";
import { ROOT_FOLDER } from "@shared/folderPath";
import type { FolderNav } from "./useFolderNav";

export function useFolderFilter({
  folderView,
  folderNav,
  filter,
  setFilter,
  setByFolder,
}: {
  folderView: boolean;
  folderNav: FolderNav;
  filter: SearchQuery;
  setFilter: (next: SearchQuery) => void;
  setByFolder: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { path, goTo, visit, moves } = folderNav;

  const filterValue = useMemo<SearchQuery>(
    () =>
      folderView && path !== ROOT_FOLDER
        ? { ...filter, folder: { path, recursive: true } }
        : filter,
    [filter, folderView, path],
  );

  // Bumped by every request to open a folder and by every change the user
  // makes to the conditions: a request still in flight commits only if
  // nothing came after it.
  const latestOpen = useRef(0);

  const onFilterChange = useCallback(
    (next: SearchQuery) => {
      latestOpen.current++;
      const { folder, ...rest } = next;
      // Removing the folder chip (or clearing everything) leaves for the root.
      const target = folder?.path ?? ROOT_FOLDER;
      if (folderView && target !== path) goTo(target);
      setFilter(rest);
    },
    [folderView, path, goTo, setFilter],
  );

  // The workspace switch in flight, if any. Switches are serialized: a
  // request waits for the one before it to settle, then decides from what is
  // active by then whether it has to switch at all.
  const switching = useRef<Promise<unknown> | null>(null);
  const activeWorkspace = useCallback(
    () => qc.getQueryData<AppStatus>(["app_status"])?.workspaceId ?? null,
    [qc],
  );
  const switchWorkspace = useCallback(
    async (ws: string) => {
      // workspace_switch does not refuse an unknown ID (a removed workspace):
      // it leaves the active one as it was and rescans it. Check first, and
      // afterwards too, in case the list was not loaded or out of date.
      const known = qc.getQueryData<WorkspacesList>(["workspaces_list"]);
      if (known && !known.workspaces.some((w) => w.id === ws)) {
        throw new Error(t("folder.workspaceGone"));
      }
      const done = (async () => {
        await api.workspaceSwitch(ws);
        await invalidateWorkspaceScoped(qc);
      })();
      switching.current = done;
      try {
        await done;
      } finally {
        if (switching.current === done) switching.current = null;
      }
      if (activeWorkspace() !== ws) throw new Error(t("folder.workspaceGone"));
    },
    [qc, t, activeWorkspace],
  );

  // Browse `folder` of workspace `ws` by folder; `next` replaces the filter as
  // well (a saved search). Nothing changes until the workspace is the one
  // shown: a failed switch leaves the list as it was. A request overtaken by
  // another, by a move or by a change of conditions is dropped.
  const openFolder = useCallback(
    async (ws: string, folder: string, next?: SearchQuery) => {
      const request = ++latestOpen.current;
      const movesAtStart = moves();
      const stale = () =>
        request !== latestOpen.current || moves() !== movesAtStart;
      while (switching.current) {
        await switching.current.catch(() => {});
      }
      if (stale()) return;
      if (ws !== activeWorkspace()) {
        try {
          await switchWorkspace(ws);
        } catch (error) {
          if (stale()) return;
          toast.error(t("folder.showFailed"), {
            id: "folder-show-failed",
            description: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      // A saved folder may be gone by now. Browsing, the view would move up on
      // its own, but with other conditions it only searches, never lists the
      // folder — so resolve its nearest remaining ancestor here.
      let target = folder;
      try {
        const listing = await qc.fetchQuery({
          queryKey: ["folders_list", ws, folder],
          queryFn: () => api.foldersList(ws, folder),
        });
        target = listing.path;
      } catch {
        // Go as asked; browsing will resolve it when the listing loads.
      }
      // Also dropped if another workspace was picked meanwhile (the rail).
      if (stale() || activeWorkspace() !== ws) return;
      if (target !== folder)
        toast.info(t("folder.moved"), { id: "folder-moved" });
      visit(ws, target);
      setByFolder(true);
      if (next) setFilter(next);
    },
    [
      qc,
      t,
      visit,
      moves,
      setByFolder,
      setFilter,
      activeWorkspace,
      switchWorkspace,
    ],
  );

  // A saved search replaces every condition, the folder included: one saved
  // without a folder opens at the root — even with the folder option off, so
  // turning it on later does not bring back the folder left behind.
  const onApplySaved = useCallback(
    (collection: SmartCollection) => {
      const { folder, ...rest } = collection.query;
      if (folder && collection.workspaceId) {
        void openFolder(collection.workspaceId, folder.path, rest);
        return;
      }
      latestOpen.current++;
      if (path !== ROOT_FOLDER) goTo(ROOT_FOLDER);
      setFilter(rest);
    },
    [openFolder, path, goTo, setFilter],
  );

  useEffect(
    () =>
      onShowFolderInLibrary(({ workspaceId: ws, path: folder }) => {
        void openFolder(ws, folder);
      }),
    [openFolder],
  );

  return { filterValue, onFilterChange, onApplySaved };
}
