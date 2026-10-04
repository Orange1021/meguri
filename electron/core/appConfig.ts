// Application-wide config (list of registered workspaces = scan roots, and the active root).
// Each root's artifacts are separated into per-root directories, so the cross-cutting list is kept here.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { LogoIdSchema, type LogoId } from "../../shared/ipc/schema.js";
import log from "./logger.js";
import { resolveWorkspaceLocator } from "./portablePaths.js";
import type { PortableLayout, WorkspaceLocator } from "./portablePaths.js";
import { pathHash } from "./paths.js";

export interface WorkspaceConfig {
  workspaceId: string;
  name: string;
  locator: WorkspaceLocator;
  legacyPathHash: string;
  createdAt: number;
}

export interface AppConfigV2 {
  formatVersion: 2;
  workspaces: WorkspaceConfig[];
  activeWorkspaceId: string | null;
  collections: UserCollectionConfig[];
  workspaceEmojis: Record<string, string>;
  logo: LogoId;
}

export interface AppConfig {
  formatVersion: 1 | 2;
  workspaces: WorkspaceConfig[];
  activeWorkspaceId: string | null;
  /** Registered roots (absolute paths, normalized). */
  roots: string[];
  /** Currently active root. null if none is selected. */
  activePath: string | null;
  /** User-curated virtual folders. Items reference files by workspace ID + file ID. */
  collections: UserCollectionConfig[];
  /** Optional per-workspace emoji icon, keyed by workspace ID (hash of root path). */
  workspaceEmojis: Record<string, string>;
  /**
   * App logo variant applied to the window and tray icons. Lives here (not in
   * the renderer's localStorage) because the tray and window are created
   * before any renderer exists, so main must be able to read it on its own.
   */
  logo: LogoId;
}

let configuredLayout: PortableLayout | undefined;

export function configureConfigStorage(layout?: PortableLayout): void {
  configuredLayout = layout;
}

export const DEFAULT_LOGO: LogoId = "orange";

function parseLogo(value: unknown): LogoId {
  return LogoIdSchema.catch(DEFAULT_LOGO).parse(value);
}

export interface UserCollectionItemConfig {
  workspaceId: string;
  fileId: number;
  addedAt: number;
}

export interface UserCollectionConfig {
  id: string;
  name: string;
  /** Optional emoji icon; falls back to the folder icon when unset. */
  emoji?: string;
  items: UserCollectionItemConfig[];
  createdAt: number;
  updatedAt: number;
  /**
   * Built-in collections (currently only "Watch Later") set this. Locked
   * collections can still gain and lose files, and their files can still be
   * rearranged, but the collection itself cannot be removed, renamed, re-iconed
   * or repositioned among the collections. Absent/false on every user-created one.
   */
  locked?: boolean;
}

function configPath(layout?: PortableLayout): string {
  const storage = layout ?? configuredLayout;
  return storage?.configPath ?? path.join(app.getPath("userData"), "config.json");
}

export function loadConfig(layout?: PortableLayout): AppConfig {
  const storage = layout ?? configuredLayout;
  try {
    const raw = JSON.parse(fs.readFileSync(configPath(storage), "utf8")) as Record<
      string,
      unknown
    >;
    const parsed = parseConfig(raw, storage);
    // Config files written by older builds may contain a retired Logo ID. Save
    // the normalized value once so later config writes cannot resurrect it.
    if (raw.logo !== parsed.logo) saveConfig(parsed, storage);
    return parsed;
  } catch {
    return {
      formatVersion: 2,
      workspaces: [],
      activeWorkspaceId: null,
      roots: [],
      activePath: null,
      collections: [],
      workspaceEmojis: {},
      logo: DEFAULT_LOGO,
    };
  }
}

function parseConfig(
  raw: Record<string, unknown>,
  layout: PortableLayout | undefined,
): AppConfig {
  const legacyRoots = Array.isArray(raw.roots)
    ? raw.roots.filter((value): value is string => typeof value === "string")
    : [];
  const records = parseWorkspaceConfigs(raw.workspaces);
  const resolvedRoots =
    layout || records.every((record) => record.locator.kind === "absolute")
      ? records
          .map((record) => {
            try {
              return resolveWorkspaceLocator(
                layout ?? fallbackLayout(),
                record.locator,
              );
            } catch {
              return null;
            }
          })
          .filter((value): value is string => value !== null)
      : [];
  const roots =
    records.length > 0 && resolvedRoots.length === records.length
      ? resolvedRoots
      : legacyRoots;
  const workspaces =
    records.length > 0
      ? records
      : roots.map((root) => workspaceRecordForRoot(root, layout, 0));
  const activeWorkspaceId =
    typeof raw.activeWorkspaceId === "string"
      ? raw.activeWorkspaceId
      : typeof raw.activePath === "string"
        ? workspaces.find((record) => {
            try {
              return (
                (layout
                  ? resolveWorkspaceLocator(layout, record.locator)
                  : record.locator.kind === "absolute"
                    ? path.resolve(record.locator.value)
                    : null) === path.resolve(raw.activePath as string)
              );
            } catch {
              return false;
            }
          })?.workspaceId ?? null
        : null;
  const activePath =
    typeof raw.activePath === "string"
      ? raw.activePath
      : activeWorkspaceId
        ? roots[workspaces.findIndex((record) => record.workspaceId === activeWorkspaceId)] ??
          null
        : null;

  return {
    formatVersion: 2,
    workspaces,
    activeWorkspaceId,
    roots,
    activePath,
    collections: parseCollections(raw.collections),
    workspaceEmojis: parseEmojiMap(raw.workspaceEmojis),
    logo: parseLogo(raw.logo),
  };
}

function parseWorkspaceConfigs(value: unknown): WorkspaceConfig[] {
  if (!Array.isArray(value)) return [];
  const out: WorkspaceConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const locatorValue = record.locator;
    if (!locatorValue || typeof locatorValue !== "object") continue;
    const locator = locatorValue as Record<string, unknown>;
    if (
      typeof record.workspaceId !== "string" ||
      typeof record.name !== "string" ||
      (locator.kind !== "portable-relative" && locator.kind !== "absolute") ||
      typeof locator.value !== "string"
    ) {
      continue;
    }
    out.push({
      workspaceId: record.workspaceId,
      name: record.name,
      locator: {
        kind: locator.kind,
        value: locator.value,
      } as WorkspaceLocator,
      legacyPathHash:
        typeof record.legacyPathHash === "string"
          ? record.legacyPathHash
          : record.workspaceId,
      createdAt:
        typeof record.createdAt === "number" ? record.createdAt : 0,
    });
  }
  return out;
}

function fallbackLayout(): PortableLayout {
  const rootDir = path.resolve(app.getPath("userData"));
  const dataDir = path.join(rootDir, "Data");
  return {
    rootDir,
    appDir: rootDir,
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

function serializeLegacy(c: AppConfig) {
  return {
    roots: c.roots,
    activePath: c.activePath,
    collections: c.collections,
    workspaceEmojis: c.workspaceEmojis,
    logo: c.logo,
  };
}

function serializeV2(c: AppConfig, layout: PortableLayout): AppConfigV2 & {
  roots: string[];
  activePath: string | null;
} {
  const workspaces = c.roots.map((root) => {
    const normalized = normalizeDir(root);
    const legacyPathHash = pathHash(normalized);
    const locator = locatorForResolvedRoot(layout, normalized);
    const previous = c.workspaces.find(
      (record) =>
        record.workspaceId === legacyPathHash ||
        record.legacyPathHash === legacyPathHash ||
        (record.locator.kind === locator.kind &&
          record.locator.value === locator.value),
    );
    const generated = workspaceRecordForRoot(root, layout, 0);
    return {
      ...generated,
      workspaceId: previous?.workspaceId ?? generated.workspaceId,
      locator,
      name: previous?.name ?? generated.name,
      legacyPathHash: previous?.legacyPathHash ?? generated.legacyPathHash,
      createdAt:
        previous?.createdAt && previous.createdAt > 0
          ? previous.createdAt
          : Math.floor(Date.now() / 1000),
    };
  });
  const activeIndex = c.activePath
    ? c.roots.findIndex((root) => root === c.activePath)
    : -1;
  return {
    formatVersion: 2,
    workspaces,
    activeWorkspaceId:
      activeIndex >= 0 ? workspaces[activeIndex]?.workspaceId ?? null : null,
    collections: c.collections,
    workspaceEmojis: c.workspaceEmojis,
    logo: c.logo,
    roots: c.roots,
    activePath: c.activePath,
  };
}

function workspaceRecordForRoot(
  root: string,
  layout: PortableLayout | undefined,
  createdAt: number,
): WorkspaceConfig {
  const normalized = normalizeDir(root);
  return {
    workspaceId: pathHash(normalized),
    name: path.basename(normalized) || normalized,
    locator: layout
      ? locatorForResolvedRoot(layout, normalized)
      : { kind: "absolute", value: normalized },
    legacyPathHash: pathHash(normalized),
    createdAt,
  };
}

export function locatorForResolvedRoot(
  layout: PortableLayout,
  root: string,
): WorkspaceLocator {
  const media = normalizeDir(layout.mediaDir);
  const resolved = normalizeDir(root);
  const relative = path.relative(media, resolved);
  const escaped =
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative);
  return escaped
    ? { kind: "absolute", value: resolved }
    : {
        kind: "portable-relative",
        value: relative.split(path.sep).join("/"),
      };
}

/**
 * Remove any leftover `config.json.<pid>.tmp` files from a previous run that
 * crashed between writeFileSync and renameSync. Safe to call at startup; the
 * single-instance lock means no other process is mid-write.
 */
export function cleanupStaleTemp(layout?: PortableLayout): void {
  try {
    const dest = configPath(layout);
    const dir = path.dirname(dest);
    const base = path.basename(dest);
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(`${base}.`) && name.endsWith(".tmp")) {
        fs.rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // Best-effort cleanup; ignore (e.g. dir doesn't exist yet on first run).
  }
}

export function saveConfig(c: AppConfig, layout?: PortableLayout): void {
  try {
    const storage = layout ?? configuredLayout;
    const dest = configPath(storage);
    const output = storage ? serializeV2(c, storage) : serializeLegacy(c);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Write to a sibling temp file then rename so a crash mid-write can't leave a
    // truncated config.json (which would drop all workspaces and collections).
    // fsync the temp file before renaming: rename is atomic for the directory
    // entry, but without fsync a power loss can land the rename while the temp's
    // data blocks are still unflushed, leaving a 0-byte/partial config.json.
    const tmp = `${dest}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeFileSync(fd, JSON.stringify(output, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, dest);
  } catch (e) {
    log.error("saveConfig failed", e);
  }
}

/**
 * Atomic read-modify-write of the config. Re-reads the current file, applies
 * `mutator`, and saves — all synchronously, so a caller holding a stale
 * snapshot across an `await` can't clobber concurrent changes to unrelated
 * fields (roots, collections, …). Pass a narrow mutation here rather than
 * spreading an old `loadConfig()` result into `saveConfig`.
 */
export function updateConfig(
  mutator: (c: AppConfig) => AppConfig,
  layout?: PortableLayout,
): void {
  const storage = layout ?? configuredLayout;
  saveConfig(mutator(loadConfig(storage)), storage);
}

/** Normalize a path (realpath, falling back to resolve on failure). */
export function normalizeDir(p: string): string {
  let normalized: string;
  try {
    normalized = fs.realpathSync(p);
  } catch {
    normalized = path.resolve(p);
  }
  // Windows drive letters are case-insensitive ("c:\x" === "C:\x") but the
  // workspace id is a hash of this string, so a casing difference would split
  // the same folder into two workspaces. Canonicalize to uppercase.
  if (process.platform === "win32") {
    normalized = normalized.replace(/^[a-z]:/, (drive) => drive.toUpperCase());
  }
  return normalized;
}

function parseCollections(value: unknown): UserCollectionConfig[] {
  if (!Array.isArray(value)) return [];
  const out: UserCollectionConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== "string" || typeof c.name !== "string") continue;
    const items: UserCollectionItemConfig[] = [];
    if (Array.isArray(c.items)) {
      for (const itemRaw of c.items) {
        if (!itemRaw || typeof itemRaw !== "object") continue;
        const item = itemRaw as Record<string, unknown>;
        if (
          typeof item.workspaceId !== "string" ||
          typeof item.fileId !== "number"
        )
          continue;
        items.push({
          workspaceId: item.workspaceId,
          fileId: item.fileId,
          addedAt: typeof item.addedAt === "number" ? item.addedAt : 0,
        });
      }
    }
    out.push({
      id: c.id,
      name: c.name,
      emoji: typeof c.emoji === "string" && c.emoji ? c.emoji : undefined,
      items,
      createdAt: typeof c.createdAt === "number" ? c.createdAt : 0,
      updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : 0,
      ...(c.locked === true ? { locked: true } : {}),
    });
  }
  return out;
}

function parseEmojiMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}
