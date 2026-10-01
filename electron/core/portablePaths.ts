import fs from "node:fs";
import path from "node:path";
import { PRODUCT_EXECUTABLE_NAME } from "../../shared/branding/product.js";

export type WorkspaceLocator =
  | { kind: "portable-relative"; value: string }
  | { kind: "absolute"; value: string };

export interface PortableLayout {
  rootDir: string;
  appDir: string;
  dataDir: string;
  mediaDir: string;
  configPath: string;
  databasePath: string;
  assetsDir: string;
  playlistsDir: string;
  backupsDir: string;
  logsDir: string;
  tempDir: string;
}

export interface PortableLayoutInput {
  appPath: string;
  executablePath: string;
  isPackaged: boolean;
  portableRootOverride?: string;
  portableExecutableDir?: string;
}

export function resolvePortableLayout(
  input: PortableLayoutInput,
): PortableLayout {
  const rootDir = resolveRootDir(input);
  const appDir = input.isPackaged
    ? path.resolve(path.dirname(input.executablePath))
    : path.resolve(input.appPath);
  const dataDir = path.join(rootDir, "Data");

  return {
    rootDir,
    appDir,
    dataDir,
    mediaDir: path.join(rootDir, "Media"),
    configPath: path.join(dataDir, "config.json"),
    databasePath: path.join(dataDir, "library.sqlite"),
    assetsDir: path.join(dataDir, "assets"),
    playlistsDir: path.join(dataDir, "playlists"),
    backupsDir: path.join(dataDir, "backups"),
    logsDir: path.join(dataDir, "logs"),
    tempDir: path.join(dataDir, "temp"),
  };
}

export function layoutForRoot(rootDir: string): PortableLayout {
  const resolvedRoot = path.resolve(rootDir);
  return resolvePortableLayout({
    appPath: path.join(resolvedRoot, "App"),
    executablePath: path.join(
      resolvedRoot,
      "App",
      `${PRODUCT_EXECUTABLE_NAME}.exe`,
    ),
    isPackaged: true,
  });
}

export function resolveWorkspaceLocator(
  layout: PortableLayout,
  locator: WorkspaceLocator,
): string {
  if (locator.kind === "absolute") {
    if (!path.isAbsolute(locator.value)) {
      throw new Error("absolute workspace locator must be absolute");
    }
    return path.resolve(locator.value);
  }

  const resolvedMediaDir = path.resolve(layout.mediaDir);
  const candidate = path.resolve(resolvedMediaDir, locator.value);
  const relative = path.relative(resolvedMediaDir, candidate);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("workspace locator escapes media root");
  }
  return candidate;
}

export function ensurePortableDirectories(layout: PortableLayout): void {
  fs.mkdirSync(layout.dataDir, { recursive: true });
  for (const directory of [
    layout.assetsDir,
    layout.playlistsDir,
    layout.backupsDir,
    layout.logsDir,
    layout.tempDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.mkdirSync(layout.mediaDir, { recursive: true });
}

function resolveRootDir(input: PortableLayoutInput): string {
  if (input.portableRootOverride) {
    return path.resolve(input.portableRootOverride);
  }

  if (input.portableExecutableDir) {
    const executableDir = path.resolve(input.portableExecutableDir);
    // electron-builder's portable launcher reports the directory containing
    // the executable. The documented layout puts that executable under App,
    // while a directly launched portable artifact puts it beside Data/Media.
    // Treat only an actual App directory as a child of the portable root.
    return path.basename(executableDir).toLowerCase() === "app"
      ? path.dirname(executableDir)
      : executableDir;
  }

  if (input.isPackaged) {
    const appDir = path.resolve(path.dirname(input.executablePath));
    return path.dirname(appDir);
  }

  return path.resolve(input.appPath, ".portable-dev");
}
