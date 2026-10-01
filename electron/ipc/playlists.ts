import { dialog } from "electron";
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { handle } from "../core/ipcHandler.js";
import { writeM3u8 } from "../core/m3u8.js";
import { buildPotPlayerLaunch, discoverPotPlayer } from "../core/player.js";
import {
  loadConfiguredPlayer,
  saveConfiguredPlayer,
} from "../core/playerConfig.js";
import * as q from "../core/queries.js";
import { isInsideRoot } from "../core/paths.js";
import type { IpcContext } from "./context.js";
import { coreById } from "./helpers.js";
import { ALL_ID, COLLECTION_ID_PREFIX } from "../../shared/workspaceIds.js";

function activeCore(ctx: IpcContext) {
  const id = ctx.ws.activeId;
  if (!id || id === ALL_ID || id.startsWith(COLLECTION_ID_PREFIX)) {
    throw new Error("playlists require one active workspace");
  }
  return coreById(ctx.ws, id);
}

function exportDirectory(
  ctx: IpcContext,
  core: ReturnType<typeof activeCore>,
): string {
  return path.join(ctx.dataDir?.() ?? core.dataDir, "temp");
}

function mediaEntries(core: ReturnType<typeof activeCore>, playlistId: string) {
  return q.resolvePlaylistMedia(core.db, playlistId).map((entry) => {
    const valid = isInsideRoot(entry.path, core.root);
    return {
      path: valid && fs.existsSync(entry.path) ? entry.path : null,
      title: path.basename(entry.relPath),
      duration: entry.duration,
    };
  });
}

function playerFor(ctx: IpcContext): {
  path: string | null;
  source: string | null;
} {
  const dataDir = ctx.dataDir?.();
  const configured = dataDir ? loadConfiguredPlayer(dataDir) : null;
  const env = { ...process.env };
  if (configured) env.MEGURI_POTPLAYER_PATH = configured;
  const found = discoverPotPlayer({ env });
  return found
    ? { path: found.path, source: found.source }
    : { path: null, source: null };
}

export function registerPlaylistHandlers(ctx: IpcContext): void {
  handle("playlist_list", () => q.listPlaylists(activeCore(ctx).db));
  handle("playlist_create", ({ name, kind, rule, sort }) =>
    q.createPlaylist(activeCore(ctx).db, { name, kind, rule, sort }),
  );
  handle("playlist_update", ({ playlistId, name, rule, sort }) =>
    q.updatePlaylist(activeCore(ctx).db, playlistId, { name, rule, sort }),
  );
  handle("playlist_delete", ({ playlistId }) =>
    q.deletePlaylist(activeCore(ctx).db, playlistId),
  );
  handle("playlist_set_items", ({ playlistId, fileIds }) => {
    const core = activeCore(ctx);
    const videoIds = fileIds
      .map((fileId) => q.videoIdForFile(core.db, fileId))
      .filter((videoId): videoId is string => videoId != null);
    q.setPlaylistItems(core.db, playlistId, videoIds);
  });
  handle("playlist_files", ({ playlistId }) => {
    const core = activeCore(ctx);
    return q.resolvePlaylistFiles(core.db, playlistId).map((row) => ({
      ...row,
      workspaceId: ctx.ws.activeId ?? "",
    }));
  });

  handle("playlist_export_m3u8", async ({ playlistId }) => {
    const core = activeCore(ctx);
    return writeM3u8(
      exportDirectory(ctx, core),
      mediaEntries(core, playlistId),
    );
  });

  handle("playlist_open_potplayer", async ({ playlistId }) => {
    const core = activeCore(ctx);
    const exported = await writeM3u8(
      exportDirectory(ctx, core),
      mediaEntries(core, playlistId),
    );
    const player = playerFor(ctx);
    if (!player.path)
      throw new Error("PotPlayer was not found; configure it in Settings");
    const launch = buildPotPlayerLaunch(player.path, exported.path);
    const child = spawn(launch.executable, launch.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return {
      playerPath: player.path,
      playlistPath: exported.path,
      included: exported.included,
      skipped: exported.skipped,
    };
  });

  handle("player_discover", () => playerFor(ctx));
  handle("player_configure", async () => {
    const result = await dialog.showOpenDialog(ctx.mainWindow() ?? undefined!, {
      title: "Choose PotPlayer executable",
      properties: ["openFile"],
      filters: [{ name: "PotPlayer", extensions: ["exe"] }],
    });
    // Cancelling configuration must preserve the previously selected player;
    // otherwise an accidental Escape silently removes a working setup.
    if (result.canceled || !result.filePaths[0]) return playerFor(ctx);
    const selected = result.filePaths[0];
    const dataDir = ctx.dataDir?.();
    if (dataDir) saveConfiguredPlayer(dataDir, selected);
    return { path: selected, source: "configured" };
  });
}
