import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceExecutable = path.resolve(
  process.argv[2] ?? path.join(repoRoot, "橙映", "橙映.exe"),
);
const electronExecutable = path.join(
  repoRoot,
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const betterSqlitePackage = path.join(
  repoRoot,
  "node_modules",
  "better-sqlite3",
);
const startupTimeoutMs = 60_000;

if (process.platform !== "win32") {
  console.log("Portable Windows smoke test skipped on non-Windows.");
  process.exit(0);
}

if (!fs.existsSync(sourceExecutable)) {
  throw new Error(`Portable executable not found: ${sourceExecutable}`);
}
if (!fs.existsSync(electronExecutable) || !fs.existsSync(betterSqlitePackage)) {
  throw new Error(
    "Portable smoke test requires the Electron and better-sqlite3 development dependencies.",
  );
}

const smokeRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "orangeview-portable-smoke-"),
);
const dataDir = path.join(smokeRoot, "Data");
const mediaDir = path.join(smokeRoot, "Media");
const activeExecutable = path.join(smokeRoot, "橙映.exe");
const stagedExecutable = path.join(smokeRoot, "橙映.new.exe");
const previousExecutable = path.join(smokeRoot, "橙映.previous.exe");
const markerPath = path.join(dataDir, "smoke-marker.txt");
const configPath = path.join(dataDir, "config.json");
const logPath = path.join(dataDir, "logs", "main.log");
const mediaFixture = path.join(
  repoRoot,
  "e2e",
  "fixtures",
  "video-media",
  "flower.mp4",
);
const initialConfig = {
  formatVersion: 2,
  workspaces: [],
  activeWorkspaceId: null,
  collections: [],
  workspaceEmojis: {},
  logo: "dark",
};
let smokePassed = false;
let indexedDatabasePath = null;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function portableDatabasePaths() {
  const rootsDir = path.join(dataDir, "roots");
  if (!fs.existsSync(rootsDir)) return [];
  return fs
    .readdirSync(rootsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootsDir, entry.name, "db.sqlite"))
    .filter((databasePath) => fs.existsSync(databasePath));
}

function queryIndexedFile(databasePath) {
  const query = [
    `const Database = require(${JSON.stringify(betterSqlitePackage)});`,
    `const db = new Database(${JSON.stringify(databasePath)}, { readonly: true, fileMustExist: true });`,
    'const row = db.prepare("SELECT rel_path AS relPath, kind, ext, size, video_id AS videoId, deleted_at AS deletedAt FROM files WHERE lower(rel_path) = lower(?) AND deleted_at IS NULL ORDER BY id LIMIT 1").get("flower.mp4");',
    "db.close();",
    "process.stdout.write(JSON.stringify(row ?? null));",
  ].join(" ");
  const result = spawnSync(electronExecutable, ["-e", query], {
    cwd: repoRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect portable database: ${result.stderr.trim() || `exit code ${result.status}`}`,
    );
  }
  const output = result.stdout.trim();
  if (!output)
    throw new Error("Portable database inspection returned no result.");
  return JSON.parse(output);
}

async function waitForIndexedDatabase() {
  const deadline = Date.now() + startupTimeoutMs;
  let lastQueryError = null;
  let nextQueryAt = 0;
  while (Date.now() < deadline) {
    if (Date.now() >= nextQueryAt) {
      const databases = portableDatabasePaths();
      for (const databasePath of databases) {
        if (fs.statSync(databasePath).size === 0) continue;
        try {
          const row = queryIndexedFile(databasePath);
          if (row) return { databasePath, row };
        } catch (error) {
          lastQueryError = error;
        }
      }
      nextQueryAt = Date.now() + 500;
    }
    await wait(250);
  }

  if (lastQueryError) {
    throw new Error(
      `Portable app could not inspect the indexed database: ${lastQueryError.message}`,
    );
  }
  throw new Error(
    `Portable app did not index flower.mp4 within ${startupTimeoutMs}ms; expected a live row below ${path.join(dataDir, "roots")}.`,
  );
}

async function cleanupSmokeRoot() {
  const cleanupAttempts = 8;
  for (let attempt = 0; attempt < cleanupAttempts; attempt += 1) {
    try {
      fs.rmSync(smokeRoot, {
        recursive: true,
        force: true,
        maxRetries: 2,
        retryDelay: 250,
      });
      return;
    } catch (error) {
      const code = error?.code;
      if (code !== "EPERM" && code !== "EBUSY") throw error;
      await wait(500);
    }
  }

  throw new Error(`Unable to clean portable smoke directory: ${smokeRoot}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid == null) return;

  const result = spawnSync(
    "taskkill.exe",
    ["/PID", String(child.pid), "/T", "/F"],
    { stdio: "ignore", windowsHide: true },
  );
  if (result.error) {
    throw new Error(`Unable to stop portable smoke process ${child.pid}.`);
  }
  if (
    result.status !== 0 &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    throw new Error(`Unable to stop portable smoke process ${child.pid}.`);
  }

  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}

async function launchAndCheck(
  executable,
  { requireIndexedDatabase = false } = {},
) {
  const beforeLog = fs.existsSync(logPath) ? fs.statSync(logPath) : null;
  const launchEnv = {
    ...process.env,
    MEGURI_ROOT: mediaDir,
    PORTABLE_EXECUTABLE_DIR: smokeRoot,
  };
  delete launchEnv.MEGURI_PORTABLE_ROOT;
  let child = null;
  let earlyExit = null;
  try {
    child = spawn(executable, [], {
      cwd: smokeRoot,
      // Keep the smoke deterministic while still exercising the real tray path.
      env: launchEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("exit", (code, signal) => {
      earlyExit = { code, signal };
    });

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      if (fs.existsSync(logPath)) {
        const currentLog = fs.statSync(logPath);
        if (
          !beforeLog ||
          currentLog.mtimeMs > beforeLog.mtimeMs ||
          currentLog.size > beforeLog.size
        ) {
          const indexed = requireIndexedDatabase
            ? await waitForIndexedDatabase()
            : null;
          return indexed;
        }
      }
      if (earlyExit) {
        throw new Error(
          `Portable app exited during smoke test: code=${earlyExit.code}, signal=${earlyExit.signal}.`,
        );
      }
      await wait(250);
    }

    throw new Error(
      `Portable app did not initialize within ${startupTimeoutMs}ms; expected a log below ${logPath}.`,
    );
  } finally {
    await stopProcess(child);
  }
}

try {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2) + "\n");
  fs.writeFileSync(markerPath, "preserve this Data file\n");
  fs.copyFileSync(mediaFixture, path.join(mediaDir, "flower.mp4"));
  fs.copyFileSync(sourceExecutable, activeExecutable);

  const firstRun = await launchAndCheck(activeExecutable, {
    requireIndexedDatabase: true,
  });
  if (!fs.existsSync(logPath) || fs.statSync(logPath).size === 0) {
    throw new Error(
      "Portable app did not write its log below the portable Data directory.",
    );
  }
  indexedDatabasePath = firstRun?.databasePath ?? null;
  if (!indexedDatabasePath) {
    throw new Error("Portable app did not retain an indexed database.");
  }
  const initialConfigHash = sha256File(configPath);
  const initialIndexedFile = firstRun.row;

  fs.copyFileSync(sourceExecutable, stagedExecutable);
  fs.renameSync(activeExecutable, previousExecutable);
  fs.renameSync(stagedExecutable, activeExecutable);
  await launchAndCheck(activeExecutable);

  const marker = fs.readFileSync(markerPath, "utf8");
  if (marker !== "preserve this Data file\n") {
    throw new Error("Data changed while replacing the portable executable.");
  }
  if (!fs.existsSync(configPath)) {
    throw new Error(
      "Data/config.json disappeared after executable replacement.",
    );
  }
  if (!fs.existsSync(logPath)) {
    throw new Error(
      "Portable app stopped using the portable Data directory after replacement.",
    );
  }
  if (
    !indexedDatabasePath ||
    !fs.existsSync(indexedDatabasePath) ||
    fs.statSync(indexedDatabasePath).size === 0
  ) {
    throw new Error(
      "Portable database disappeared after executable replacement.",
    );
  }
  if (sha256File(configPath) !== initialConfigHash) {
    throw new Error(
      "Data/config.json changed unexpectedly after executable replacement.",
    );
  }
  const finalIndexedFile = queryIndexedFile(indexedDatabasePath);
  if (JSON.stringify(finalIndexedFile) !== JSON.stringify(initialIndexedFile)) {
    throw new Error(
      "The indexed media record changed after executable replacement.",
    );
  }

  smokePassed = true;
  console.log(
    "Portable Windows smoke test passed: launch, replace EXE, preserve Data.",
  );
} finally {
  if (!smokePassed && process.env.PORTABLE_SMOKE_KEEP === "1") {
    console.error(`Portable smoke files kept for diagnosis: ${smokeRoot}`);
  } else {
    await cleanupSmokeRoot();
  }
}
