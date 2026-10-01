import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { DB } from "./db.js";

export interface BackupManifest {
  backupId: string;
  appVersion: string;
  schemaVersion: number;
  databaseFile: string;
  configFile: string;
  databaseSha256: string;
  configSha256: string;
  databaseBytes: number;
  configBytes: number;
  createdAt: number;
  databaseTargetRelative?: string;
}

export interface BackupRecord {
  manifest: BackupManifest;
  directory: string;
  databasePath: string;
  configPath: string;
  manifestPath: string;
}

export class BackupValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BackupValidationError";
  }
}

export interface CreateBackupOptions {
  db: DB;
  configPath: string;
  backupsDir: string;
  appVersion: string;
  now?: () => number;
  targetDatabasePath?: string;
}

export async function copyDatabaseSnapshot(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const source = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await source.backup(targetPath);
  } finally {
    source.close();
  }
}

export async function createBackup(
  options: CreateBackupOptions,
): Promise<BackupRecord> {
  fs.mkdirSync(options.backupsDir, { recursive: true });
  const createdAt = (options.now ?? (() => Math.floor(Date.now() / 1000)))();
  const backupId = String(createdAt) + "-" + randomUUID();
  const temporaryDirectory = path.join(
    options.backupsDir,
    backupId + ".tmp",
  );
  const finalDirectory = path.join(options.backupsDir, backupId);
  fs.mkdirSync(temporaryDirectory);

  try {
    const temporaryDatabasePath = path.join(
      temporaryDirectory,
      "library.sqlite",
    );
    const temporaryConfigPath = path.join(temporaryDirectory, "config.json");
    const temporaryManifestPath = path.join(
      temporaryDirectory,
      "manifest.json",
    );
    await options.db.backup(temporaryDatabasePath);
    fs.copyFileSync(options.configPath, temporaryConfigPath);

    const manifest: BackupManifest = {
      backupId,
      appVersion: options.appVersion,
      schemaVersion: schemaVersion(options.db),
      databaseFile: "library.sqlite",
      configFile: "config.json",
      databaseSha256: hashFile(temporaryDatabasePath),
      configSha256: hashFile(temporaryConfigPath),
      databaseBytes: fs.statSync(temporaryDatabasePath).size,
      configBytes: fs.statSync(temporaryConfigPath).size,
      createdAt,
      ...(options.targetDatabasePath
        ? {
            databaseTargetRelative: path.relative(
              path.dirname(options.backupsDir),
              options.targetDatabasePath,
            ),
          }
        : {}),
    };
    fs.writeFileSync(
      temporaryManifestPath,
      JSON.stringify(manifest, null, 2) + "\n",
      { encoding: "utf8", flag: "wx" },
    );
    fs.renameSync(temporaryDirectory, finalDirectory);
    try {
      return validateBackup({
        backupsDir: options.backupsDir,
        backupId,
      });
    } catch (error) {
      fs.rmSync(finalDirectory, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function validateBackup(options: {
  backupsDir: string;
  backupId: string;
}): BackupRecord {
  assertSafeBackupId(options.backupId);
  const directory = path.join(options.backupsDir, options.backupId);
  const manifestPath = path.join(directory, "manifest.json");
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf8"),
    ) as BackupManifest;
  } catch (error) {
    throw new BackupValidationError(
      "backup manifest cannot be read",
      { cause: error },
    );
  }

  if (
    manifest.backupId !== options.backupId ||
    !Number.isSafeInteger(manifest.createdAt) ||
    !Number.isSafeInteger(manifest.schemaVersion) ||
    !manifest.databaseFile ||
    !manifest.configFile ||
    (manifest.databaseTargetRelative !== undefined &&
      typeof manifest.databaseTargetRelative !== "string")
  ) {
    throw new BackupValidationError("backup manifest is invalid");
  }
  if (manifest.databaseTargetRelative !== undefined) {
    resolveDatabaseTarget(options.backupsDir, manifest.databaseTargetRelative);
  }
  const databasePath = safeManifestPath(directory, manifest.databaseFile);
  const configPath = safeManifestPath(directory, manifest.configFile);
  verifyFile(databasePath, manifest.databaseBytes, manifest.databaseSha256);
  verifyFile(configPath, manifest.configBytes, manifest.configSha256);
  return {
    manifest,
    directory,
    databasePath,
    configPath,
    manifestPath,
  };
}

export function listValidatedBackups(backupsDir: string): BackupRecord[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".tmp"))
    .map((entry) => {
      try {
        return validateBackup({
          backupsDir,
          backupId: entry.name,
        });
      } catch {
        return null;
      }
    })
    .filter((record): record is BackupRecord => record !== null)
    .sort((left, right) => right.manifest.createdAt - left.manifest.createdAt);
}

export function restoreBackup(options: {
  backupsDir: string;
  backupId: string;
  targetDatabasePath?: string;
  targetConfigPath: string;
  closeDatabase?: () => void;
}): BackupRecord {
  const record = validateBackup({
    backupsDir: options.backupsDir,
    backupId: options.backupId,
  });
  const targetDatabasePath =
    options.targetDatabasePath ??
    (record.manifest.databaseTargetRelative
      ? resolveDatabaseTarget(
          options.backupsDir,
          record.manifest.databaseTargetRelative,
        )
      : null);
  if (!targetDatabasePath) {
    throw new BackupValidationError(
      "backup does not specify a database restore target",
    );
  }
  const targetDirectory = path.dirname(targetDatabasePath);
  fs.mkdirSync(targetDirectory, { recursive: true });
  const temporaryDirectory = fs.mkdtempSync(
    path.join(targetDirectory, ".restore-"),
  );
  const temporaryDatabasePath = path.join(
    temporaryDirectory,
    path.basename(targetDatabasePath),
  );
  const temporaryConfigPath = path.join(
    temporaryDirectory,
    path.basename(options.targetConfigPath),
  );

  try {
    fs.copyFileSync(record.databasePath, temporaryDatabasePath);
    fs.copyFileSync(record.configPath, temporaryConfigPath);
    verifyFile(
      temporaryDatabasePath,
      record.manifest.databaseBytes,
      record.manifest.databaseSha256,
    );
    verifyFile(
      temporaryConfigPath,
      record.manifest.configBytes,
      record.manifest.configSha256,
    );
    options.closeDatabase?.();
    replaceFilesAtomically([
      { source: temporaryDatabasePath, target: targetDatabasePath },
      { source: temporaryConfigPath, target: options.targetConfigPath },
    ]);
    return record;
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function schemaVersion(db: DB): number {
  try {
    const row = db
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

function hashFile(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function assertSafeBackupId(backupId: string): void {
  if (
    !backupId ||
    backupId === "." ||
    backupId === ".." ||
    path.basename(backupId) !== backupId
  ) {
    throw new BackupValidationError("invalid backup id");
  }
}

function safeManifestPath(directory: string, name: string): string {
  if (!name || path.basename(name) !== name) {
    throw new BackupValidationError("backup manifest contains an unsafe path");
  }
  return path.join(directory, name);
}

function resolveDatabaseTarget(backupsDir: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) {
    throw new BackupValidationError("unsafe database restore target");
  }
  const dataDir = path.resolve(path.dirname(backupsDir));
  const target = path.resolve(dataDir, relative);
  const withinDataDir = path.relative(dataDir, target);
  if (
    !withinDataDir ||
    withinDataDir === ".." ||
    withinDataDir.startsWith(".." + path.sep) ||
    path.isAbsolute(withinDataDir)
  ) {
    throw new BackupValidationError("unsafe database restore target");
  }
  return target;
}

function verifyFile(file: string, bytes: number, sha256: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    throw new BackupValidationError("backup file is missing", { cause: error });
  }
  if (stat.size !== bytes || hashFile(file) !== sha256) {
    throw new BackupValidationError("backup file checksum mismatch");
  }
}

function replaceFilesAtomically(
  files: Array<{ source: string; target: string }>,
): void {
  const token = randomUUID();
  const staged = files.map((file, index) => ({
    ...file,
    old: file.target + ".restore-old-" + token + "-" + index,
    movedOld: false,
    movedNew: false,
  }));
  try {
    for (const file of staged) {
      if (fs.existsSync(file.target)) {
        fs.renameSync(file.target, file.old);
        file.movedOld = true;
      }
    }
    for (const file of staged) {
      fs.renameSync(file.source, file.target);
      file.movedNew = true;
    }
    for (const file of staged) {
      if (file.movedOld) fs.rmSync(file.old, { force: true });
    }
  } catch (error) {
    for (const file of [...staged].reverse()) {
      if (file.movedNew && fs.existsSync(file.target)) {
        fs.rmSync(file.target, { force: true });
      }
      if (file.movedOld && fs.existsSync(file.old)) {
        fs.renameSync(file.old, file.target);
      }
    }
    throw error;
  }
}
