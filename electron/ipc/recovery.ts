import { handle } from "../core/ipcHandler.js";
import {
  listValidatedBackups,
  restoreBackup,
  validateBackup,
} from "../core/backups.js";
import {
  preparePortableData,
  retryPortableData,
  type PreparePortableDataOptions,
  type RecoveryStatus,
} from "../core/portableRecovery.js";
import type { PortableLayout } from "../core/portablePaths.js";
import type { RecoveryBackup } from "../../shared/ipc/schema.js";

export interface RecoveryIpcContext {
  layout: PortableLayout;
  prepareOptions: PreparePortableDataOptions;
  getStatus: () => RecoveryStatus;
  setStatus: (status: RecoveryStatus) => void;
  onReady: () => void;
  readOnly?: boolean;
}

export function registerRecoveryIpc(ctx: RecoveryIpcContext): void {
  handle("recovery_status", () => ctx.getStatus());
  handle("recovery_list_backups", (): RecoveryBackup[] =>
    listValidatedBackups(ctx.layout.backupsDir).map((record) => ({
      backupId: record.manifest.backupId,
      createdAt: record.manifest.createdAt,
      appVersion: record.manifest.appVersion,
      schemaVersion: record.manifest.schemaVersion,
    })),
  );
  if (ctx.readOnly) return;
  handle("recovery_retry", async ({ initialize }) => {
    const status = await retryPortableData(ctx.layout, {
      ...ctx.prepareOptions,
      initialize,
    });
    ctx.setStatus(status);
    if (status.state === "ready") ctx.onReady();
    return status;
  });
  handle("recovery_restore", async ({ backupId }) => {
    try {
      validateBackup({
        backupsDir: ctx.layout.backupsDir,
        backupId,
      });
      restoreBackup({
        backupsDir: ctx.layout.backupsDir,
        backupId,
        targetConfigPath: ctx.layout.configPath,
      });
      const status = await preparePortableData(
        ctx.layout,
        ctx.prepareOptions,
      );
      ctx.setStatus(status);
      if (status.state === "ready") ctx.onReady();
      return status;
    } catch {
      const status = ctx.getStatus();
      ctx.setStatus({
        ...status,
        state: "restore-available",
        messageCode: "portable-restore-failed",
      });
      return ctx.getStatus();
    }
  });
}
