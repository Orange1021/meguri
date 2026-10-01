import { createHash, randomUUID } from "node:crypto";
import type { DB } from "./db.js";

export interface MigrationContext {
  now: () => number;
}

export interface MigrationStep {
  version: number;
  name: string;
  sql: string;
  apply: (db: DB, context: MigrationContext) => void;
}

export interface MigrationRegistry {
  baselineVersion: number;
  steps: readonly MigrationStep[];
}

export type MigrationErrorCode =
  | "legacy-schema-unrecognized"
  | "migration-checksum-mismatch"
  | "migration-missing"
  | "migration-failed";

export class MigrationError extends Error {
  constructor(
    readonly code: MigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MigrationError";
  }
}

const PORTABLE_METADATA_SQL = [
  "CREATE TABLE IF NOT EXISTS portable_metadata (",
  "  id INTEGER PRIMARY KEY CHECK (id = 1),",
  "  layout_version INTEGER NOT NULL DEFAULT 1,",
  "  app_version TEXT,",
  "  last_backup_id TEXT",
  ");",
  "INSERT OR IGNORE INTO portable_metadata (id, layout_version)",
  "VALUES (1, 1);",
].join("\n");

const VIDEO_IDENTITY_SQL = [
  "CREATE TABLE IF NOT EXISTS videos (",
  "  video_id TEXT PRIMARY KEY,",
  "  kind TEXT NOT NULL CHECK (kind IN ('video','image','audio')),",
  "  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','missing')),",
  "  created_at INTEGER NOT NULL,",
  "  updated_at INTEGER NOT NULL,",
  "  last_seen_at INTEGER,",
  "  missing_at INTEGER",
  ");",
  "CREATE TABLE IF NOT EXISTS fingerprints (",
  "  id INTEGER PRIMARY KEY,",
  "  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,",
  "  algorithm TEXT NOT NULL,",
  "  version TEXT NOT NULL,",
  "  fingerprint_key TEXT NOT NULL,",
  "  size INTEGER NOT NULL,",
  "  duration_ms INTEGER,",
  "  first_hash TEXT,",
  "  last_hash TEXT,",
  "  full_hash TEXT,",
  "  stream_signature TEXT NOT NULL,",
  "  computed_at INTEGER NOT NULL,",
  "  UNIQUE (file_id, algorithm, version)",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_fingerprints_key",
  "  ON fingerprints(algorithm, version, fingerprint_key);",
  "CREATE TABLE IF NOT EXISTS scan_runs (",
  "  run_id TEXT PRIMARY KEY,",
  "  root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,",
  "  status TEXT NOT NULL CHECK (status IN ('running','completed','aborted','failed')),",
  "  phase TEXT,",
  "  started_at INTEGER NOT NULL,",
  "  finished_at INTEGER,",
  "  stats_json TEXT,",
  "  error_code TEXT,",
  "  error_detail TEXT",
  ");",
  "CREATE TABLE IF NOT EXISTS scan_issues (",
  "  id INTEGER PRIMARY KEY,",
  "  run_id TEXT NOT NULL REFERENCES scan_runs(run_id) ON DELETE CASCADE,",
  "  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,",
  "  issue_type TEXT NOT NULL,",
  "  severity TEXT NOT NULL CHECK (severity IN ('warning','error')),",
  "  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),",
  "  candidate_video_ids_json TEXT,",
  "  details_json TEXT,",
  "  created_at INTEGER NOT NULL,",
  "  resolved_at INTEGER",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_scan_issues_run_status",
  "  ON scan_issues(run_id, status);",
  "CREATE INDEX IF NOT EXISTS idx_scan_issues_file_status",
  "  ON scan_issues(file_id, status);",
  "CREATE INDEX IF NOT EXISTS idx_files_video_id ON files(video_id);",
].join("\n");

const ASSET_PIPELINE_SQL = [
  "CREATE TABLE IF NOT EXISTS assets (",
  "  asset_id TEXT PRIMARY KEY,",
  "  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,",
  "  kind TEXT NOT NULL CHECK (kind IN ('cover','sheet','manual-original')),",
  "  source TEXT NOT NULL CHECK (source IN ('manual','embedded','sidecar','auto')),",
  "  path TEXT NOT NULL,",
  "  generation_version TEXT NOT NULL,",
  "  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','generating','ready','failed','retired')),",
  "  error_code TEXT,",
  "  created_at INTEGER NOT NULL,",
  "  updated_at INTEGER NOT NULL,",
  "  UNIQUE (video_id, kind, source)",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_assets_video_kind_status",
  "  ON assets(video_id, kind, status);",
  "CREATE TABLE IF NOT EXISTS asset_tasks (",
  "  task_id TEXT PRIMARY KEY,",
  "  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,",
  "  kind TEXT NOT NULL CHECK (kind IN ('cover','sheet')),",
  "  source TEXT NOT NULL CHECK (source IN ('embedded','sidecar','auto')),",
  "  generation_version TEXT NOT NULL,",
  "  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),",
  "  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),",
  "  next_attempt_at INTEGER NOT NULL,",
  "  error_code TEXT,",
  "  created_at INTEGER NOT NULL,",
  "  updated_at INTEGER NOT NULL,",
  "  UNIQUE (video_id, kind, source, generation_version)",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_asset_tasks_ready",
  "  ON asset_tasks(status, next_attempt_at);",
].join("\n");

const PLAYLIST_SQL = [
  "CREATE TABLE IF NOT EXISTS playlists (",
  "  playlist_id TEXT PRIMARY KEY,",
  "  kind TEXT NOT NULL CHECK (kind IN ('static','smart')),",
  "  name TEXT NOT NULL,",
  "  rule_json TEXT,",
  "  sort_json TEXT,",
  "  created_at INTEGER NOT NULL,",
  "  updated_at INTEGER NOT NULL,",
  "  CHECK ((kind = 'static' AND rule_json IS NULL) OR (kind = 'smart' AND rule_json IS NOT NULL))",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_playlists_updated ON playlists(updated_at DESC);",
  "CREATE TABLE IF NOT EXISTS playlist_items (",
  "  playlist_id TEXT NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,",
  "  video_id TEXT NOT NULL REFERENCES videos(video_id) ON DELETE CASCADE,",
  "  position INTEGER NOT NULL CHECK (position >= 0),",
  "  added_at INTEGER NOT NULL,",
  "  PRIMARY KEY (playlist_id, video_id),",
  "  UNIQUE (playlist_id, position)",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_playlist_items_video ON playlist_items(video_id);",
].join("\n");

export const DEFAULT_MIGRATION_REGISTRY: MigrationRegistry = {
  baselineVersion: 0,
  steps: [
    {
      version: 1,
      name: "portable-metadata-v1",
      sql: PORTABLE_METADATA_SQL,
      apply: (db) => {
        db.exec(PORTABLE_METADATA_SQL);
      },
    },
    {
      version: 2,
      name: "video-identity-v1",
      sql: VIDEO_IDENTITY_SQL,
      apply: (db, context) => {
        ensureVideoIdColumn(db);
        db.exec(VIDEO_IDENTITY_SQL);
        backfillLegacyVideoIdentities(db, context.now());
      },
    },
    {
      version: 3,
      name: "asset-pipeline-v1",
      sql: ASSET_PIPELINE_SQL,
      apply: (db) => {
        db.exec(ASSET_PIPELINE_SQL);
      },
    },
    {
      version: 4,
      name: "playlists-v1",
      sql: PLAYLIST_SQL,
      apply: (db) => {
        db.exec(PLAYLIST_SQL);
      },
    },
  ],
};

function ensureVideoIdColumn(db: DB): void {
  const columns = db.prepare("PRAGMA table_info(files)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "video_id")) {
    db.exec("ALTER TABLE files ADD COLUMN video_id TEXT");
  }
}

function backfillLegacyVideoIdentities(db: DB, now: number): void {
  const rows = db
    .prepare(
      "SELECT id, kind, deleted_at AS deletedAt, created_at AS createdAt " +
        "FROM files WHERE video_id IS NULL ORDER BY id",
    )
    .all() as Array<{
    id: number;
    kind: "video" | "image" | "audio";
    deletedAt: number | null;
    createdAt: number | null;
  }>;
  if (rows.length === 0) return;

  const insert = db.prepare(
    "INSERT INTO videos " +
      "(video_id, kind, status, created_at, updated_at, last_seen_at, missing_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const bind = db.prepare("UPDATE files SET video_id = ? WHERE id = ?");
  for (const row of rows) {
    const createdAt = row.createdAt ?? now;
    const missing = row.deletedAt != null;
    const videoId = randomUUID();
    insert.run(
      videoId,
      row.kind,
      missing ? "missing" : "active",
      createdAt,
      now,
      missing ? null : now,
      missing ? row.deletedAt : null,
    );
    bind.run(videoId, row.id);
  }
}

export function migrationChecksum(step: MigrationStep): string {
  return createHash("sha256")
    .update(String(step.version) + "\n" + step.name + "\n" + step.sql, "utf8")
    .digest("hex");
}

export function applyMigrations(
  db: DB,
  options: {
    context?: MigrationContext;
    registry?: MigrationRegistry;
  } = {},
): void {
  const registry = options.registry ?? DEFAULT_MIGRATION_REGISTRY;
  const context = options.context ?? {
    now: () => Math.floor(Date.now() / 1000),
  };
  validateRegistry(registry);
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "version INTEGER PRIMARY KEY, " +
      "name TEXT NOT NULL, " +
      "checksum TEXT NOT NULL, " +
      "applied_at INTEGER NOT NULL" +
      ")",
  );

  let rows = readMigrationRows(db);
  const baseline = rows.find((row) => row.version === registry.baselineVersion);
  if (!baseline) {
    validateLegacySchema(db);
    db.prepare(
      "INSERT INTO schema_migrations " +
        "(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    ).run(
      registry.baselineVersion,
      "legacy-baseline",
      "legacy-baseline-v1",
      context.now(),
    );
    rows = readMigrationRows(db);
  } else if (baseline.checksum !== "legacy-baseline-v1") {
    throw new MigrationError(
      "migration-checksum-mismatch",
      "migration checksum mismatch for legacy baseline",
    );
  }

  const stepsByVersion = new Map(
    registry.steps.map((step) => [step.version, step]),
  );
  for (const row of rows) {
    if (row.version === registry.baselineVersion) continue;
    const step = stepsByVersion.get(row.version);
    if (!step) {
      throw new MigrationError(
        "migration-missing",
        "migration " + row.version + " is not present in the registry",
      );
    }
    if (row.name !== step.name || row.checksum !== migrationChecksum(step)) {
      throw new MigrationError(
        "migration-checksum-mismatch",
        "migration checksum mismatch for version " + row.version,
      );
    }
  }

  for (const step of [...registry.steps].sort(
    (left, right) => left.version - right.version,
  )) {
    if (step.version <= registry.baselineVersion) continue;
    if (rows.some((row) => row.version === step.version)) continue;
    if (
      rows.some(
        (row) =>
          row.version > registry.baselineVersion && row.version > step.version,
      )
    ) {
      throw new MigrationError(
        "migration-missing",
        "migration " + step.version + " is missing before a later migration",
      );
    }

    try {
      db.transaction(() => {
        step.apply(db, context);
        db.prepare(
          "INSERT INTO schema_migrations " +
            "(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        ).run(step.version, step.name, migrationChecksum(step), context.now());
      })();
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new MigrationError(
        "migration-failed",
        "migration failed for version " + step.version + ": " + detail,
        { cause: error },
      );
    }
    rows = readMigrationRows(db);
  }
}

interface MigrationRow {
  version: number;
  name: string;
  checksum: string;
  appliedAt: number;
}

function readMigrationRows(db: DB): MigrationRow[] {
  return db
    .prepare(
      "SELECT version, name, checksum, applied_at AS appliedAt " +
        "FROM schema_migrations ORDER BY version",
    )
    .all() as MigrationRow[];
}

function validateRegistry(registry: MigrationRegistry): void {
  const seen = new Set<number>();
  for (const step of registry.steps) {
    if (step.version <= registry.baselineVersion) {
      throw new MigrationError(
        "migration-missing",
        "migration version " + step.version + " is not after the baseline",
      );
    }
    if (seen.has(step.version)) {
      throw new MigrationError(
        "migration-missing",
        "duplicate migration version " + step.version,
      );
    }
    seen.add(step.version);
  }
}

function validateLegacySchema(db: DB): void {
  const required = new Set(["scan_roots", "files"]);
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
    )
    .all("scan_roots", "files") as Array<{ name: string }>;
  for (const table of tables) required.delete(table.name);
  if (required.size > 0) {
    throw new MigrationError(
      "legacy-schema-unrecognized",
      "legacy schema is missing required tables: " + [...required].join(", "),
    );
  }
}
