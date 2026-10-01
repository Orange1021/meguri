import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  ListVideo,
  PlayCircle,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import type { PlaylistSummary } from "@/ipc/types";
import type { TFunc } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The saved-playlist entry point intentionally lives in the workspace header:
 * playlists are workspace-local, while the existing in-app player continues
 * to play the current list/filter. Export and PotPlayer actions therefore do
 * not alter navigation state or surprise the current queue.
 */
export function PlaylistMenu({
  workspaceId,
  ready,
  fileIds,
  t,
}: {
  workspaceId: string | null;
  ready: boolean;
  fileIds: number[];
  t: TFunc;
}) {
  const qc = useQueryClient();
  const enabled = Boolean(workspaceId && ready);
  const playlists = useQuery({
    queryKey: ["playlist_list", workspaceId],
    queryFn: api.playlistList,
    enabled,
  });

  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["playlist_list", workspaceId] });

  const createStatic = async () => {
    const name = window.prompt(t("savedPlaylist.namePrompt"));
    if (!name?.trim()) return;
    try {
      const created = await api.playlistCreate(name, "static");
      if (fileIds.length > 0) {
        await api.playlistSetItems(created.playlistId, fileIds);
      }
      await refresh();
      toast.success(t("savedPlaylist.created", { name: created.name }));
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const createSmart = async () => {
    const name = window.prompt(t("savedPlaylist.namePrompt"));
    if (!name?.trim()) return;
    const tag = window.prompt(t("savedPlaylist.tagPrompt"));
    if (!tag?.trim()) return;
    try {
      const created = await api.playlistCreate(name, "smart", {
        op: "tag",
        value: tag,
      });
      await refresh();
      toast.success(t("savedPlaylist.created", { name: created.name }));
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const openPotPlayer = async (playlist: PlaylistSummary) => {
    try {
      const result = await api.playlistOpenPotPlayer(playlist.playlistId);
      if (result.skipped > 0) {
        toast.info(
          t("savedPlaylist.openedWithSkipped", { skipped: result.skipped }),
        );
      } else {
        toast.success(t("savedPlaylist.opened", { name: playlist.name }));
      }
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const exportM3u8 = async (playlist: PlaylistSummary) => {
    try {
      const result = await api.playlistExportM3u8(playlist.playlistId);
      toast.success(
        t("savedPlaylist.exported", {
          count: result.included,
          path: result.path,
        }),
      );
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const deletePlaylist = async (playlist: PlaylistSummary) => {
    if (
      !window.confirm(t("savedPlaylist.deleteConfirm", { name: playlist.name }))
    ) {
      return;
    }
    try {
      await api.playlistDelete(playlist.playlistId);
      await refresh();
      toast.success(t("savedPlaylist.deleted", { name: playlist.name }));
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const configurePlayer = async () => {
    try {
      await api.playerConfigure();
    } catch (error) {
      toast.error(t("savedPlaylist.failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="border border-muted/35 bg-surface px-2"
          disabled={!enabled}
          aria-label={t("savedPlaylist.title")}
          title={t("savedPlaylist.title")}
        >
          <ListVideo />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-64 border border-muted/35 bg-surface p-0"
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="rounded-none px-3 py-2 text-xs"
            onSelect={() => void createStatic()}
          >
            <Plus />
            {t("savedPlaylist.newStatic")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="rounded-none px-3 py-2 text-xs"
            onSelect={() => void createSmart()}
          >
            <Plus />
            {t("savedPlaylist.newSmart")}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
          {playlists.isLoading ? (
            <DropdownMenuItem
              disabled
              className="rounded-none px-3 py-2 text-xs"
            >
              {t("savedPlaylist.loading")}
            </DropdownMenuItem>
          ) : playlists.data?.length ? (
            playlists.data.flatMap((playlist) => [
              <DropdownMenuItem
                key={`${playlist.playlistId}:open`}
                className="rounded-none px-3 py-2 text-xs"
                onSelect={() => void openPotPlayer(playlist)}
              >
                <PlayCircle />
                <span className="min-w-0 flex-1 truncate">{playlist.name}</span>
                <span className="text-muted">{playlist.itemCount}</span>
              </DropdownMenuItem>,
              <DropdownMenuItem
                key={`${playlist.playlistId}:export`}
                className="rounded-none px-3 py-2 pl-9 text-xs"
                onSelect={() => void exportM3u8(playlist)}
              >
                <Download />
                {t("savedPlaylist.export")}
              </DropdownMenuItem>,
              <DropdownMenuItem
                key={`${playlist.playlistId}:delete`}
                className="rounded-none px-3 py-2 pl-9 text-xs text-error data-[highlighted]:text-error"
                onSelect={() => void deletePlaylist(playlist)}
              >
                <Trash2 />
                {t("savedPlaylist.delete")}
              </DropdownMenuItem>,
            ])
          ) : (
            <DropdownMenuItem
              disabled
              className="rounded-none px-3 py-2 text-xs"
            >
              {t("savedPlaylist.empty")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator className="mx-0 my-0 bg-muted/35" />
          <DropdownMenuItem
            className="rounded-none px-3 py-2 text-xs"
            onSelect={() => void configurePlayer()}
          >
            <Settings2 />
            {t("savedPlaylist.configurePlayer")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
