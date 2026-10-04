import { clipboard, shell } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { handle } from "../core/ipcHandler.js";
import log from "../core/logger.js";
import { folderDirInsideRoot, folderPathUnderRoot } from "../core/paths.js";
import * as q from "../core/queries.js";
import type { IpcContext } from "./context.js";
import { coreById, ensureFileInsideRoot } from "./helpers.js";

// Launch an external file/URL in a fully detached child process.
// shell.openPath leaves the spawned process attached to Electron's process
// tree; on Wayland/Hyprland that makes the launched app's window a child of
// 橙映 and blocks the main window until the external app closes.
// Windows uses shell.openPath directly: ShellExecuteExW doesn't reproduce the
// child-process attachment issue, and routing through cmd.exe /c start would
// open a command-injection surface for filenames containing &/|/^/( etc.
function openDetached(target: string): void {
  if (process.platform === "win32") {
    void shell.openPath(target);
    return;
  }
  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(cmd, [target], { detached: true, stdio: "ignore" });
  child.on("error", (e) => {
    log.error("[openDetached] failed to launch", cmd, target, e);
  });
  child.unref();
}

export function registerShellHandlers(ctx: IpcContext): void {
  const { ws } = ctx;

  handle("open_external", ({ id, workspaceId }) => {
    const c = coreById(ws, workspaceId);
    const abs = ensureFileInsideRoot(c, id);
    openDetached(abs);
    q.recordPlay(c.db, id, "external", null);
    ws.removeFromWatchLater(workspaceId, id);
  });

  handle("open_folder", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(ws, workspaceId), id);
    shell.showItemInFolder(abs);
  });

  // A folder of the folder view, in the default file manager. Opened detached
  // like a media file (see openDetached): xdg-open/open/Explorer all hand a
  // directory to the file manager. Windows' openPath reports failure as a
  // string rather than rejecting, so it is checked here for the renderer to
  // show; the detached spawn elsewhere cannot report back and only logs.
  handle("folder_open_in_file_manager", async ({ workspaceId, path }) => {
    const c = coreById(ws, workspaceId);
    const dir = folderDirInsideRoot(c.root, path);
    if (!dir) throw new Error("folder not found");
    if (process.platform === "win32") {
      const error = await shell.openPath(dir);
      if (error) throw new Error(error);
      return;
    }
    openDetached(dir);
  });

  // The folder's path as the user knows it (the configured root, links left
  // as they are), once it is confirmed to be a real directory inside the root.
  handle("folder_copy_path", ({ workspaceId, path }) => {
    const c = coreById(ws, workspaceId);
    if (!folderDirInsideRoot(c.root, path)) throw new Error("folder not found");
    clipboard.writeText(folderPathUnderRoot(c.root, path));
  });

  handle("copy_file_path", ({ id, workspaceId }) => {
    const abs = ensureFileInsideRoot(coreById(ws, workspaceId), id);
    clipboard.writeText(abs);
  });

  handle("open_log_directory", async () => {
    const dataDir = ctx.dataDir?.();
    if (!dataDir) throw new Error("data directory unavailable");
    const error = await shell.openPath(path.join(dataDir, "logs"));
    if (error) throw new Error(error);
  });

  handle("open_devtools", () => {
    if (!ctx.isDevMode()) return false;
    ctx.mainWindow()?.webContents.openDevTools({ mode: "right" });
    return true;
  });

  // Close the window from the renderer (Esc on the bare list screen). Goes
  // through close() so the tray-hide behavior in the "close" handler applies.
  handle("window_close", () => {
    ctx.mainWindow()?.close();
  });
}
