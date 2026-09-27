// Folder view: a workspace's folders are derived from its files' rel_paths on
// every call, so both channels are plain read-only queries on the query worker.
import { MAX_BULK_FILES } from "../../shared/tags.js";
import { handle } from "../core/ipcHandler.js";
import type { FolderFilesResult, FolderListing } from "../core/types.js";
import type { IpcContext } from "./context.js";
import { coreById, queryTargets } from "./helpers.js";

export function registerFolderHandlers(ctx: IpcContext): void {
  const { ws, queryClient } = ctx;

  // Addressed by workspace id rather than "the active one", like file_get: a
  // listing requested just before a workspace switch still answers for the
  // workspace it was asked about.
  const target = (workspaceId: string) =>
    queryTargets([{ id: workspaceId, core: coreById(ws, workspaceId) }]);

  handle("folders_list", ({ workspaceId, path }) =>
    queryClient.run<FolderListing>({
      kind: "folders",
      targets: target(workspaceId),
      path,
    }),
  );
  handle("folder_files", ({ workspaceId, paths }) =>
    queryClient.run<FolderFilesResult>({
      kind: "folderFiles",
      targets: target(workspaceId),
      paths,
      // One row past the bulk-edit cap is enough for the renderer to know
      // the edit would be refused; reading further is wasted work.
      limit: MAX_BULK_FILES + 1,
    }),
  );
}
