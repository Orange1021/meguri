import { createHash } from "node:crypto";
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
  ],
};

export function migrationChecksum(step: MigrationStep): string {
  return createHash("sha256")
    .update(
      String(step.version) + "\n" + step.name + "\n" + step.sql,
      "utf8",
    )
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
  const baseline = rows.find(
    (row) => row.version === registry.baselineVersion,
  );
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
    if (
      row.name !== step.name ||
      row.checksum !== migrationChecksum(step)
    ) {
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
          row.version > registry.baselineVersion &&
          row.version > step.version,
      )
    ) {
      throw new MigrationError(
        "migration-missing",
        "migration " +
          step.version +
          " is missing before a later migration",
      );
    }

    try {
      db.transaction(() => {
        step.apply(db, context);
        db.prepare(
          "INSERT INTO schema_migrations " +
            "(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        ).run(
          step.version,
          step.name,
          migrationChecksum(step),
          context.now(),
        );
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
      "legacy schema is missing required tables: " +
        [...required].join(", "),
    );
  }
}
