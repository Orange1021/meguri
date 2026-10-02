export type VideoDisplayMode = "contain" | "cover" | "fill";

export const DEFAULT_VIDEO_DISPLAY_MODE: VideoDisplayMode = "contain";
export const VIDEO_DISPLAY_MODE_STORAGE_KEY = "meguri.video.display-modes";

type DisplayModeMap = Record<string, Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVideoDisplayMode(value: unknown): value is VideoDisplayMode {
  return value === "contain" || value === "cover" || value === "fill";
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readMap(storage: Storage): DisplayModeMap {
  try {
    const raw = storage.getItem(VIDEO_DISPLAY_MODE_STORAGE_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as DisplayModeMap) : {};
  } catch {
    return {};
  }
}

export function readVideoDisplayMode(
  workspaceId: string,
  fileId: string,
  storage?: Storage,
): VideoDisplayMode {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return DEFAULT_VIDEO_DISPLAY_MODE;

  const map = readMap(resolvedStorage);
  const workspaceModes = map[workspaceId];
  const mode = isRecord(workspaceModes) ? workspaceModes[fileId] : undefined;
  return isVideoDisplayMode(mode) ? mode : DEFAULT_VIDEO_DISPLAY_MODE;
}

export function writeVideoDisplayMode(
  workspaceId: string,
  fileId: string,
  mode: VideoDisplayMode,
  storage?: Storage,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage || !isVideoDisplayMode(mode)) return;

  const map = readMap(resolvedStorage);
  const currentWorkspaceModes = map[workspaceId];
  const workspaceModes = isRecord(currentWorkspaceModes)
    ? currentWorkspaceModes
    : {};

  map[workspaceId] = { ...workspaceModes, [fileId]: mode };

  try {
    resolvedStorage.setItem(
      VIDEO_DISPLAY_MODE_STORAGE_KEY,
      JSON.stringify(map),
    );
  } catch {
    // Storage can be unavailable or full; playback must continue regardless.
  }
}
