import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackup,
  restoreBackup,
  validateBackup,
} from "../backups.js";

const fixtures: Array<{
  db: Database.Database;
  directory: string;
  dbPath: string;
  configPath: string;
  backupsDir: string;
}> = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    if (fixture.db.open) fixture.db.close();
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

function createFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-backups-"));
  const dbPath = path.join(directory, "library.sqlite");
  const configPath = path.join(directory, "config.json");
  const backupsDir = path.join(directory, "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ roots: ["Media"] }));

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(
    "CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL);",
  );
  db.prepare("INSERT INTO sample (value) VALUES (?)").run("before-backup");
  fixtures.push({ db, directory, dbPath, configPath, backupsDir });
  return fixtures[fixtures.length - 1];
}

describe("backup service", () => {
  it("publishes a WAL-consistent snapshot and manifest atomically", async () => {
    const fixture = createFixture();
    const result = await createBackup({
      db: fixture.db,
      configPath: fixture.configPath,
      backupsDir: fixture.backupsDir,
      appVersion: "0.8.0",
    });

    expect(result.manifest.schemaVersion).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(result.databasePath)).toBe(true);
    expect(fs.existsSync(result.configPath)).toBe(true);
    expect(
      fs.readdirSync(fixture.backupsDir).every((name) => !name.endsWith(".tmp")),
    ).toBe(true);

    const validated = validateBackup({
      backupsDir: fixture.backupsDir,
      backupId: result.manifest.backupId,
    });
    expect(validated.manifest.databaseSha256).toBe(
      result.manifest.databaseSha256,
    );
  });

  it("restores validated database and config snapshots", async () => {
    const fixture = createFixture();
    const result = await createBackup({
      db: fixture.db,
      configPath: fixture.configPath,
      backupsDir: fixture.backupsDir,
      appVersion: "0.8.0",
    });

    fixture.db.close();
    fs.writeFileSync(fixture.configPath, JSON.stringify({ roots: ["changed"] }));
    const changedDb = new Database(fixture.dbPath);
    changedDb
      .prepare("UPDATE sample SET value = ? WHERE id = 1")
      .run("changed");
    changedDb.close();

    restoreBackup({
      backupsDir: fixture.backupsDir,
      backupId: result.manifest.backupId,
      targetDatabasePath: fixture.dbPath,
      targetConfigPath: fixture.configPath,
    });

    const restoredDb = new Database(fixture.dbPath, { readonly: true });
    expect(
      restoredDb.prepare("SELECT value FROM sample WHERE id = 1").get(),
    ).toEqual({ value: "before-backup" });
    restoredDb.close();
    expect(JSON.parse(fs.readFileSync(fixture.configPath, "utf8"))).toEqual({
      roots: ["Media"],
    });
  });
});
