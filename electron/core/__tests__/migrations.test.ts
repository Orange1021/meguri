import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  DEFAULT_MIGRATION_REGISTRY,
  type MigrationRegistry,
} from "../migrations.js";
import { openDb } from "../db.js";

const fixtures: Array<{ db: Database.Database; directory: string }> = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function openLegacyFixtureDb(): Database.Database {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-migrations-"),
  );
  const db = new Database(path.join(directory, "library.sqlite"));
  db.exec(
    "CREATE TABLE scan_roots (id INTEGER PRIMARY KEY); " +
      "CREATE TABLE files (" +
      "id INTEGER PRIMARY KEY, root_id INTEGER, " +
      "kind TEXT NOT NULL DEFAULT 'video', deleted_at INTEGER, " +
      "created_at INTEGER NOT NULL DEFAULT 0, video_id TEXT);",
  );
  fixtures.push({ db, directory });
  return db;
}

function openMigratedFixtureDb(): Database.Database {
  const db = openLegacyFixtureDb();
  applyMigrations(db, { context: { now: () => 1_700_000_000 } });
  return db;
}

describe("applyMigrations", () => {
  it("applies migration metadata when a workspace database opens", () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-open-db-"),
    );
    const db = openDb(path.join(directory, "library.sqlite"));
    fixtures.push({ db, directory });

    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([{ version: 0 }, { version: 1 }, { version: 2 }]);
  });

  it("records a legacy baseline and applies a new migration once", () => {
    const db = openLegacyFixtureDb();

    applyMigrations(db, { context: { now: () => 1_700_000_000 } });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([{ version: 0 }, { version: 1 }, { version: 2 }]);

    applyMigrations(db, { context: { now: () => 1_700_000_001 } });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 3 });
  });

  it("rejects a changed checksum instead of silently accepting a migration", () => {
    const db = openMigratedFixtureDb();
    const changedRegistry: MigrationRegistry = {
      ...DEFAULT_MIGRATION_REGISTRY,
      steps: DEFAULT_MIGRATION_REGISTRY.steps.map((step) => ({
        ...step,
        sql: step.sql + " -- changed",
      })),
    };

    expect(() => applyMigrations(db, { registry: changedRegistry })).toThrow(
      "migration checksum mismatch",
    );
  });

  it("leaves the original schema when a migration fails", () => {
    const db = openLegacyFixtureDb();
    const failingRegistry: MigrationRegistry = {
      baselineVersion: 0,
      steps: [
        {
          version: 1,
          name: "failing-step",
          sql: "CREATE TABLE transient_table (id INTEGER PRIMARY KEY)",
          apply: (migrationDb) => {
            migrationDb.exec(
              "CREATE TABLE transient_table (id INTEGER PRIMARY KEY)",
            );
            throw new Error("migration failed");
          },
        },
      ],
    };

    expect(() =>
      applyMigrations(db, { registry: failingRegistry }),
    ).toThrow("migration failed");
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='files'",
        )
        .get(),
    ).toEqual({ name: "files" });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='transient_table'",
        )
        .get(),
    ).toBeUndefined();
  });

  it("gives legacy file rows one stable identity without merging them", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-v2-"));
    const file = path.join(directory, "legacy.sqlite");
    const seed = openDb(file);
    seed.exec(
      "DROP TABLE scan_issues; DROP TABLE scan_runs; " +
        "DROP TABLE fingerprints; DROP TABLE videos; " +
        "DELETE FROM schema_migrations WHERE version = 2; " +
        "DROP TABLE files",
    );
    seed.exec(`
      CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        abs_path TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('video','image')),
        ext TEXT, size INTEGER, mtime INTEGER, inode INTEGER, content_hash TEXT,
        width INTEGER, height INTEGER, duration REAL, codec TEXT, fps REAL, captured_at INTEGER,
        thumb_path TEXT, thumb_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (thumb_status IN ('pending','done','error')),
        deleted_at INTEGER, excluded_at INTEGER, created_at INTEGER NOT NULL, meta TEXT,
        meta_key TEXT GENERATED ALWAYS AS
          (COALESCE(content_hash, 'p:' || root_id || ':' || rel_path)) VIRTUAL,
        UNIQUE (root_id, rel_path)
      );
      INSERT INTO scan_roots (id, path, path_hash, created_at)
        VALUES (1, '/r', 'h', 100);
      INSERT INTO files (id, root_id, rel_path, abs_path, kind, created_at)
        VALUES (7, 1, 'a.mp4', '/r/a.mp4', 'video', 101),
               (9, 1, 'gone.mp4', '/r/gone.mp4', 'video', 102);
      UPDATE files SET deleted_at = 200 WHERE id = 9;
    `);
    seed.close();

    const reopened = openDb(file);
    const rows = reopened
      .prepare(
        "SELECT f.id, f.video_id, v.status FROM files f JOIN videos v ON v.video_id = f.video_id ORDER BY f.id",
      )
      .all() as Array<{ id: number; video_id: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].video_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(new Set(rows.map((row) => row.video_id)).size).toBe(2);
    expect(rows.map((row) => row.status)).toEqual(["active", "missing"]);
    reopened.close();

    const secondOpen = openDb(file);
    expect(
      secondOpen.prepare("SELECT id, video_id FROM files ORDER BY id").all(),
    ).toEqual(
      rows.map((row) => ({ id: row.id, video_id: row.video_id })),
    );
    secondOpen.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
});
