import { dialog } from "electron";
import { handle } from "../core/ipcHandler.js";
import {
  importManualCover,
  restoreAutomaticCoverAndProcess,
} from "../core/assetService.js";
import { assetAbsolutePath } from "../core/assets.js";
import { listAssets } from "../core/queries/assets.js";
import * as q from "../core/queries.js";
import { scopedLog } from "../core/logger.js";
import type { IpcContext } from "./context.js";
import { coreById, ensureFileInsideRoot } from "./helpers.js";

const log = scopedLog("assets");

function assetSummary(row: ReturnType<typeof listAssets>[number]) {
  return {
    assetId: row.assetId,
    videoId: row.videoId,
    kind: row.kind,
    source: row.source,
    path: row.path,
    generationVersion: row.generationVersion,
    status: row.status,
  };
}

function videoIdForFile(
  core: ReturnType<typeof coreById>,
  fileId: number,
): string {
  const row = core.db
    .prepare(
      "SELECT video_id AS videoId FROM files WHERE id = ? AND deleted_at IS NULL",
    )
    .get(fileId) as { videoId: string | null } | undefined;
  if (!row?.videoId) throw new Error("file has no stable identity yet");
  return row.videoId;
}

export function registerAssetHandlers(ctx: IpcContext): void {
  const { ws } = ctx;
  handle("assets_list", ({ id, workspaceId }) => {
    const core = coreById(ws, workspaceId);
    ensureFileInsideRoot(core, id);
    return listAssets(core.db, videoIdForFile(core, id)).map(assetSummary);
  });

  handle("asset_set_manual_cover", async ({ id, workspaceId }) => {
    const core = coreById(ws, workspaceId);
    ensureFileInsideRoot(core, id);
    const videoId = videoIdForFile(core, id);
    const result = await dialog.showOpenDialog(ctx.mainWindow() ?? undefined!, {
      title: "Choose a manual cover",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["webp", "png", "jpg", "jpeg"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const asset = await importManualCover(core, videoId, result.filePaths[0]);
    const assetPath = assetAbsolutePath(core.assetsDir(), asset.path);
    if (assetPath) {
      // Keep the existing list/detail thumbnail pipeline in sync with the
      // durable asset projection. This makes a manual cover visible without
      // requiring every renderer consumer to learn the new asset URL format.
      q.setThumb(core.db, id, assetPath, "done");
      ctx.emit("thumb:done", { id, workspaceId });
    }
    return assetSummary(asset);
  });

  handle("asset_restore_auto_cover", ({ id, workspaceId }) => {
    const core = coreById(ws, workspaceId);
    ensureFileInsideRoot(core, id);
    const videoId = videoIdForFile(core, id);
    // Do not let the old manual thumb become the source of the regenerated
    // automatic cover. It is cleared before the retryable task is claimed.
    q.setThumb(core.db, id, null, "pending");
    void restoreAutomaticCoverAndProcess(core, videoId, { limit: 1 })
      .then((asset) => {
        const assetPath = asset
          ? assetAbsolutePath(core.assetsDir(), asset.path)
          : null;
        q.setThumb(
          core.db,
          id,
          assetPath,
          assetPath ? "done" : "error",
        );
        ctx.emit("thumb:done", {
          id,
          workspaceId,
          ready: assetPath != null,
        });
      })
      .catch((error: unknown) => {
        log.warn("automatic cover restore failed:", error);
        q.setThumb(core.db, id, null, "error");
        ctx.emit("thumb:done", { id, workspaceId, ready: false });
      });
  });
}
