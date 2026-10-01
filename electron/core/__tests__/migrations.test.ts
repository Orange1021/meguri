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
      "CREATE TABLE files (id INTEGER PRIMARY KEY, root_id INTEGER);",
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
    ).toEqual([{ version: 0 }, { version: 1 }]);
  });

  it("records a legacy baseline and applies a new migration once", () => {
    const db = openLegacyFixtureDb();

    applyMigrations(db, { context: { now: () => 1_700_000_000 } });
    expect(
      db
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all(),
    ).toEqual([{ version: 0 }, { version: 1 }]);

    applyMigrations(db, { context: { now: () => 1_700_000_001 } });
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get(),
    ).toEqual({ count: 2 });
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
});
