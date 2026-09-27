// The folder a queue is drawn from, spelled from its workspace down
// ("Music / YouTube"), the root being the workspace itself. For
// FolderScopeChip.
import { useQuery } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import { useAppStatus } from "@/hooks/useAppStatus";
import { splitFolderPath } from "@shared/folderPath";

/**
 * The folder as a path under its workspace's name, or null for no folder.
 * The active workspace is the one a folder view (and what it opens) is in.
 */
export function useFolderScopeLabel(
  path: string | null | undefined,
): string | null {
  const workspaceId = useAppStatus().data?.workspaceId;
  const workspaces = useQuery({
    queryKey: ["workspaces_list"],
    queryFn: api.workspacesList,
  });
  if (path == null) return null;
  const root =
    workspaces.data?.workspaces.find((w) => w.id === workspaceId)?.label ??
    null;
  const parts = [...(root ? [root] : []), ...splitFolderPath(path)];
  return parts.length > 0 ? parts.join(" / ") : null;
}
