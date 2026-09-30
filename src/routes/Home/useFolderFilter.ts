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
import type { AppStatus, SearchQuery } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { onShowFolderInLibrary } from "@/lib/ui-events";
import type { SmartCollection } from "@/lib/smartCollections";
import { invalidateWorkspaceScoped } from "@/lib/workspaceScope";
import { ROOT_FOLDER } from "@shared/folderPath";
import type { FolderNav } from "./useFolderNav";

export function useFolderFilter({
  workspaceId,
  folderView,
  folderNav,
  filter,
  setFilter,
  setByFolder,
}: {
  workspaceId: string | null;
  folderView: boolean;
  folderNav: FolderNav;
  filter: SearchQuery;
  setFilter: (next: SearchQuery) => void;
  setByFolder: (on: boolean) => void;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { path, goTo, visit } = folderNav;

  const filterValue = useMemo<SearchQuery>(
    () =>
      folderView && path !== ROOT_FOLDER
        ? { ...filter, folder: { path, recursive: true } }
        : filter,
    [filter, folderView, path],
  );

  const onFilterChange = useCallback(
    (next: SearchQuery) => {
      const { folder, ...rest } = next;
      // Removing the folder chip (or clearing everything) leaves for the root.
      const target = folder?.path ?? ROOT_FOLDER;
      if (folderView && target !== path) goTo(target);
      setFilter(rest);
    },
    [folderView, path, goTo, setFilter],
  );

  const workspaceIdRef = useRef(workspaceId);
  useEffect(() => {
    workspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  // Browse `folder` of workspace `ws` by folder; `next` replaces the filter as
  // well (a saved search). Nothing changes until the workspace is the one
  // shown: a failed switch leaves the list as it was. Only the latest request
  // lands, should a slow switch be overtaken by another.
  const latestOpen = useRef(0);
  const openFolder = useCallback(
    async (ws: string, folder: string, next?: SearchQuery) => {
      const request = ++latestOpen.current;
      const stale = () => request !== latestOpen.current;
      if (ws !== workspaceIdRef.current) {
        try {
          await api.workspaceSwitch(ws);
          await invalidateWorkspaceScoped(qc);
          // An unknown ID (a removed workspace) is not refused: the switch
          // just leaves the active workspace as it was.
          const active = qc.getQueryData<AppStatus>([
            "app_status",
          ])?.workspaceId;
          if (active !== ws) throw new Error(t("folder.workspaceGone"));
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
      if (stale()) return;
      if (target !== folder)
        toast.info(t("folder.moved"), { id: "folder-moved" });
      visit(ws, target);
      setByFolder(true);
      if (next) setFilter(next);
    },
    [qc, t, visit, setByFolder, setFilter],
  );

  // A saved search replaces every condition, the folder included: one saved
  // without a folder opens at the root.
  const onApplySaved = useCallback(
    (collection: SmartCollection) => {
      const { folder, ...rest } = collection.query;
      if (folder && collection.workspaceId) {
        void openFolder(collection.workspaceId, folder.path, rest);
      } else {
        onFilterChange(rest);
      }
    },
    [openFolder, onFilterChange],
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
