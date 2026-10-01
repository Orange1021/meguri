import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  activateStagedApp,
  layoutForRoot,
  rollbackPortableApp,
} from "../portable-upgrade.mjs";

function createRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "meguri-portable-upgrade-"));
}

function writeManifest(appDir, appVersion) {
  fs.mkdirSync(path.join(appDir, "resources"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "Meguri.exe"), appVersion);
  fs.writeFileSync(path.join(appDir, "resources", "app.asar"), appVersion);
  fs.writeFileSync(
    path.join(appDir, "portable-manifest.json"),
    JSON.stringify({
      formatVersion: 1,
      appVersion,
      executable: "Meguri.exe",
      minDataLayoutVersion: 1,
      maxDataLayoutVersion: 1,
      minConfigFormatVersion: 2,
      maxConfigFormatVersion: 2,
      migrationPolicy: "backup-before-migrate",
    }),
  );
}

function hashTree(directory) {
  const hash = crypto.createHash("sha256");
  const visit = (current, relative = "") => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      hash.update(entryRelative + "\0");
      if (entry.isDirectory()) visit(entryPath, entryRelative);
      else hash.update(fs.readFileSync(entryPath));
    }
  };
  visit(directory);
  return hash.digest("hex");
}

function removeRoot(rootDir) {
  fs.rmSync(rootDir, { recursive: true, force: true });
}

test("activation swaps App slots while preserving Data byte-for-byte", () => {
  const rootDir = createRoot();
  try {
    const layout = layoutForRoot(rootDir);
    fs.mkdirSync(layout.activeAppDir, { recursive: true });
    fs.mkdirSync(layout.stagedAppDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "Data", "roots", "stable"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(rootDir, "Data", "config.json"),
      JSON.stringify({ formatVersion: 2, workspaces: [] }),
    );
    fs.writeFileSync(
      path.join(rootDir, "Data", "roots", "stable", "db.sqlite"),
      "database-placeholder",
    );
    fs.writeFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "old");
    writeManifest(layout.stagedAppDir, "new");

    const dataHashBefore = hashTree(path.join(rootDir, "Data"));
    const result = activateStagedApp(rootDir);

    assert.equal(result.appVersion, "new");
    assert.equal(
      fs.readFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "utf8"),
      "new",
    );
    assert.equal(
      fs.readFileSync(path.join(layout.previousAppDir, "Meguri.exe"), "utf8"),
      "old",
    );
    assert.equal(hashTree(path.join(rootDir, "Data")), dataHashBefore);
    assert.equal(fs.existsSync(layout.stagedAppDir), false);
  } finally {
    removeRoot(rootDir);
  }
});

test("rollback restores the previous App and keeps the staged version available as previous", () => {
  const rootDir = createRoot();
  try {
    const layout = layoutForRoot(rootDir);
    fs.mkdirSync(layout.activeAppDir, { recursive: true });
    fs.mkdirSync(layout.previousAppDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "Data"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "Data", "config.json"), "stable-data");
    fs.writeFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "new");
    fs.writeFileSync(path.join(layout.previousAppDir, "Meguri.exe"), "old");

    const dataHashBefore = hashTree(path.join(rootDir, "Data"));
    const result = rollbackPortableApp(rootDir);

    assert.equal(result.appVersion, null);
    assert.equal(
      fs.readFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "utf8"),
      "old",
    );
    assert.equal(
      fs.readFileSync(path.join(layout.previousAppDir, "Meguri.exe"), "utf8"),
      "new",
    );
    assert.equal(hashTree(path.join(rootDir, "Data")), dataHashBefore);
  } finally {
    removeRoot(rootDir);
  }
});

test("activation rejects an incompatible Data config before touching App slots", () => {
  const rootDir = createRoot();
  try {
    const layout = layoutForRoot(rootDir);
    fs.mkdirSync(layout.activeAppDir, { recursive: true });
    fs.mkdirSync(layout.stagedAppDir, { recursive: true });
    fs.mkdirSync(path.join(rootDir, "Data"), { recursive: true });
    fs.writeFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "old");
    writeManifest(layout.stagedAppDir, "new");
    fs.writeFileSync(
      path.join(rootDir, "Data", "config.json"),
      JSON.stringify({ formatVersion: 1 }),
    );

    assert.throws(
      () => activateStagedApp(rootDir),
      (error) =>
        error?.code === "data-incompatible" &&
        /config format/i.test(error.message),
    );
    assert.equal(fs.existsSync(layout.previousAppDir), false);
    assert.equal(
      fs.readFileSync(path.join(layout.activeAppDir, "Meguri.exe"), "utf8"),
      "old",
    );
    assert.equal(fs.existsSync(layout.stagedAppDir), true);
  } finally {
    removeRoot(rootDir);
  }
});
