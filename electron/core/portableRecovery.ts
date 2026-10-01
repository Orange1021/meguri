import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LOGO,
  locatorForResolvedRoot,
  normalizeDir,
  type AppConfigV2,
  type WorkspaceConfig,
} from "./appConfig.js";
import { copyDatabaseSnapshot } from "./backups.js";
import {
  ensurePortableDirectories,
  type PortableLayout,
} from "./portablePaths.js";
import { pathHash } from "./paths.js";
import { LogoIdSchema } from "../../shared/ipc/schema.js";

export { locatorForResolvedRoot } from "./appConfig.js";

export interface LegacyImportOptions {
  layout: PortableLayout;
  legacyUserDataDir: string;
  legacyConfigPath?: string;
  appVersion?: string;
  now?: () => number;
}

export type ImportStatus =
  | "migrated"
  | "already-current"
  | "recovery-required";

export interface ImportResult {
  status: ImportStatus;
  messageCode?: string;
  manifestPath?: string;
}

interface ImportManifestEntry {
  source: string;
  destination: string;
  bytes: number;
  sha256: string;
}

interface ImportManifest {
  formatVersion: 1;
  createdAt: number;
  appVersion: string;
  sourceConfigPath: string;
  files: ImportManifestEntry[];
}

let importInProgress = false;

export async function importLegacyUserData(
  options: LegacyImportOptions,
): Promise<ImportResult> {
  if (importInProgress) {
    return {
      status: "recovery-required",
      messageCode: "legacy-import-in-progress",
    };
  }
  importInProgress = true;
  try {
    return await importLegacyUserDataLocked(options);
  } finally {
    importInProgress = false;
  }
}

async function importLegacyUserDataLocked(
  options: LegacyImportOptions,
): Promise<ImportResult> {
  const layout = options.layout;
  ensurePortableDirectories(layout);
  const existing = readJsonIfPresent(layout.configPath);
  if (existing?.formatVersion === 2 && Array.isArray(existing.workspaces)) {
    return { status: "already-current" };
  }
  if (fs.existsSync(layout.configPath)) {
    return {
      status: "recovery-required",
      messageCode: "portable-config-present-but-unrecognized",
    };
  }
  const finalRootsDir = path.join(layout.dataDir, "roots");
  if (fs.existsSync(finalRootsDir)) {
    return {
      status: "recovery-required",
      messageCode: "portable-data-present-without-config",
    };
  }

  const legacyConfigPath =
    options.legacyConfigPath ??
    path.join(options.legacyUserDataDir, "config.json");
  const legacyConfig = readJsonIfPresent(legacyConfigPath);
  if (!legacyConfig) {
    return {
      status: "recovery-required",
      messageCode: "legacy-config-missing",
    };
  }
  const roots = stringArray(legacyConfig.roots);
  const createdAt = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const workspaceRecords = roots.map((root) =>
    workspaceRecord(root, layout, createdAt),
  );
  const activeRoot =
    typeof legacyConfig.activePath === "string"
      ? normalizeDir(legacyConfig.activePath)
      : null;
  const activeWorkspaceId =
    activeRoot === null
      ? null
      : workspaceRecords[
          roots.findIndex((root) => normalizeDir(root) === activeRoot)
        ]?.workspaceId ?? null;
  const normalizedRoots = roots.map(normalizeDir);
  const config = buildConfig(
    legacyConfig,
    workspaceRecords,
    normalizedRoots,
    activeRoot,
    activeWorkspaceId,
  );

  const importDirectory = fs.mkdtempSync(
    path.join(layout.tempDir, "import-" + randomUUID() + "-"),
  );
  const manifestEntries: ImportManifestEntry[] = [];
  let rootsPublished = false;
  let configPublished = false;
  let manifestPublished = false;
  const importRootsDir = path.join(importDirectory, "roots");
  const temporaryConfigPath = path.join(importDirectory, "config.json");
  const temporaryManifestPath = path.join(importDirectory, "import-manifest.json");
  const manifestPath = path.join(layout.dataDir, "import-manifest.json");

  try {
    fs.mkdirSync(importRootsDir, { recursive: true });
    for (const root of roots) {
      const hash = pathHash(normalizeDir(root));
      const sourceRootDir = path.join(
        options.legacyUserDataDir,
        "roots",
        hash,
      );
      const destinationRootDir = path.join(importRootsDir, hash);
      await copyLegacyRootData(
        sourceRootDir,
        destinationRootDir,
        manifestEntries,
        importRootsDir,
      );
    }
    writeJson(temporaryConfigPath, config);
    manifestEntries.push({
      source: legacyConfigPath,
      destination: "config.json",
      bytes: fs.statSync(temporaryConfigPath).size,
      sha256: hashFile(temporaryConfigPath),
    });
    const manifest: ImportManifest = {
      formatVersion: 1,
      createdAt,
      appVersion: options.appVersion ?? "unknown",
      sourceConfigPath: legacyConfigPath,
      files: manifestEntries,
    };
    writeJson(temporaryManifestPath, manifest);
    validateManifest(manifest, importDirectory, temporaryConfigPath);

    fs.renameSync(importRootsDir, finalRootsDir);
    rootsPublished = true;
    fs.renameSync(temporaryConfigPath, layout.configPath);
    configPublished = true;
    fs.renameSync(temporaryManifestPath, manifestPath);
    manifestPublished = true;
    return { status: "migrated", manifestPath };
  } catch (error) {
    if (manifestPublished) fs.rmSync(manifestPath, { force: true });
    if (configPublished) fs.rmSync(layout.configPath, { force: true });
    if (rootsPublished && fs.existsSync(finalRootsDir)) {
      fs.renameSync(finalRootsDir, importRootsDir);
    }
    return {
      status: "recovery-required",
      messageCode:
        error instanceof Error ? "legacy-import-failed" : "legacy-import-failed",
    };
  } finally {
    fs.rmSync(importDirectory, { recursive: true, force: true });
  }
}

function workspaceRecord(
  root: string,
  layout: PortableLayout,
  createdAt: number,
): WorkspaceConfig {
  const normalized = normalizeDir(root);
  return {
    workspaceId: pathHash(normalized),
    name: path.basename(normalized) || normalized,
    locator: locatorForResolvedRoot(layout, normalized),
    legacyPathHash: pathHash(normalized),
    createdAt,
  };
}

function buildConfig(
  raw: Record<string, unknown>,
  workspaces: WorkspaceConfig[],
  roots: string[],
  activePath: string | null,
  activeWorkspaceId: string | null,
): AppConfigV2 & { roots: string[]; activePath: string | null } {
  const rawUpdate = raw.update;
  const updateRecord =
    rawUpdate && typeof rawUpdate === "object"
      ? (rawUpdate as Record<string, unknown>)
      : null;
  const update =
    updateRecord
      ? {
          autoCheck:
            typeof updateRecord.autoCheck === "boolean"
              ? updateRecord.autoCheck
              : true,
          ignoredVersion:
            typeof updateRecord.ignoredVersion === "string"
              ? updateRecord.ignoredVersion
              : null,
          lastCheckAt:
            typeof updateRecord.lastCheckAt === "number"
              ? updateRecord.lastCheckAt
              : null,
        }
      : { autoCheck: true, ignoredVersion: null, lastCheckAt: null };
  return {
    formatVersion: 2,
    workspaces,
    activeWorkspaceId,
    roots,
    activePath,
    collections: Array.isArray(raw.collections) ? raw.collections : [],
    workspaceEmojis:
      raw.workspaceEmojis && typeof raw.workspaceEmojis === "object"
        ? (raw.workspaceEmojis as Record<string, string>)
        : {},
    logo: LogoIdSchema.catch(DEFAULT_LOGO).parse(raw.logo),
    update,
  };
}

async function copyLegacyRootData(
  sourceDirectory: string,
  destinationDirectory: string,
  entries: ImportManifestEntry[],
  manifestRootDirectory: string,
): Promise<void> {
  if (!fs.existsSync(sourceDirectory)) return;
  fs.mkdirSync(destinationDirectory, { recursive: true });
  for (const entry of fs.readdirSync(sourceDirectory, {
    withFileTypes: true,
  })) {
    const source = path.join(sourceDirectory, entry.name);
    const destination = path.join(destinationDirectory, entry.name);
    if (
      entry.name === "db.sqlite-wal" ||
      entry.name === "db.sqlite-shm"
    ) {
      continue;
    }
    if (entry.isDirectory()) {
      await copyLegacyRootData(
        source,
        destination,
        entries,
        manifestRootDirectory,
      );
      continue;
    }
    if (entry.name === "db.sqlite") {
      await copyDatabaseSnapshot(source, destination);
    } else {
      fs.copyFileSync(source, destination);
    }
    entries.push({
      source,
      destination: path.relative(manifestRootDirectory, destination),
      bytes: fs.statSync(destination).size,
      sha256: hashFile(destination),
    });
  }
}

function validateManifest(
  manifest: ImportManifest,
  importDirectory: string,
  configPath: string,
): void {
  for (const entry of manifest.files) {
    const destination =
      entry.destination === "config.json"
        ? configPath
        : path.join(importDirectory, "roots", entry.destination);
    if (
      fs.statSync(destination).size !== entry.bytes ||
      hashFile(destination) !== entry.sha256
    ) {
      throw new Error("legacy import checksum mismatch");
    }
  }
}

function readJsonIfPresent(file: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function writeJson(file: string, value: unknown): void {
  const fd = fs.openSync(file, "w");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function hashFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
