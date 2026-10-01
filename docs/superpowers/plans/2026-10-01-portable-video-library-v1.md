# Portable Video Library V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the existing Meguri application run from a portable App directory while keeping configuration, databases, backups, and derived assets in a portable Data directory that survives drive-letter changes and application upgrades.

**Architecture:** Add a pure portable-layout resolver and inject its paths into the existing config, workspace, and SQLite layers. Keep the current per-workspace schema and query API compatible in V1, but add a checksummed migration runner, consistent backups, stable portable workspace locators, and an explicit recovery state. Stable video_id, fingerprint conflict handling, visual asset models, playlists, and PotPlayer integration remain later phases.

**Tech Stack:** Electron 42, Node.js 22+, TypeScript strict, React, better-sqlite3, SQLite WAL/FTS5, Zod IPC schemas, Vitest, Playwright, electron-builder.

---

## Scope and non-goals

This plan implements only the phase 1 requirements from the design and the project方案: portable root resolution, Data separation, relative workspace locators, versioned migrations, backup/recovery, and Windows-safe baseline execution.

It does not implement the phase 2 video_id/fingerprint model, phase 3 Cover/Sheet asset queue, phase 4 tag-expression playlists, or phase 5 M3U8/PotPlayer adapter. Those changes must use the phase 1 interfaces rather than bypass them.

## File map

### Create

- scripts/run-electron-vitest.mjs — cross-platform Electron-as-Node Vitest launcher.
- electron/core/portablePaths.ts — pure portable layout types, resolution, and directory creation.
- electron/core/migrations.ts — schema migration registry, baseline detection, checksum validation, and transactional execution.
- electron/core/backups.ts — SQLite/config snapshot creation, manifest validation, and atomic backup publication.
- electron/core/portableRecovery.ts — legacy userData import, Data initialization, failure classification, and restore orchestration.
- electron/core/__tests__/portablePaths.test.ts — layout and drive-letter tests.
- electron/core/__tests__/migrations.test.ts — schema version, checksum, idempotency, and rollback tests.
- electron/core/__tests__/backups.test.ts — WAL-consistent snapshot and atomic publication tests.
- electron/core/__tests__/portableRecovery.test.ts — legacy import, missing Data, and failure recovery tests.
- e2e/portable-data.spec.ts — packaged app Data separation, restart, and recovery smoke tests.

### Modify

- package.json — replace the Unix-only test:core environment assignment with the Node launcher.
- electron/core/paths.ts — use the injected portable layout while preserving testable path helpers.
- electron/core/appConfig.ts — persist config inside Data and read the versioned workspace locator format.
- electron/core/db.ts — call the migration runner before opening read-only query handles.
- electron/core/index.ts — initialize workspace storage below Data and expose the same Core API.
- electron/core/workspaces.ts — resolve portable-relative and absolute locators while keeping legacy config readable.
- electron/main.ts — resolve the layout before opening workspaces; enter recovery mode on missing Data or migration failure.
- electron/preload.ts — expose only typed recovery/status operations needed by the recovery page.
- shared/ipc/channelNames.ts — add recovery status and recovery action channels.
- shared/ipc/channels.ts — define Zod input and typed output for recovery channels.
- shared/ipc/schema.ts — define portable layout/recovery DTOs.
- src/ipc/client.ts — add typed recovery calls.
- src/App.tsx or the existing startup route — render the recovery page before the library when startup is not ready.
- src/i18n/locales/{ja,en,es,fr,ko,zh-CN}.ts — keep all locale keys in sync for recovery messages.
- .gitignore — ignore .portable-dev/ and other local Data fixtures.
- docs/README.md, docs/data-model.md, docs/build-and-ci.md, README.md — document the new layout, migration contract, and restore workflow.

## Task 1: Make the baseline test command Windows-safe

**Files:**
- Create: scripts/run-electron-vitest.mjs
- Modify: package.json, scripts.test:core
- Test: electron/core/__tests__/db.test.ts and the complete core project

- [ ] Step 1: Write the failing verification command.

Run the existing command before changing the script:

~~~powershell
npm test
~~~

Expected baseline on Windows: exit 1 with 'ELECTRON_RUN_AS_NODE is not recognized as an internal or external command'.

- [ ] Step 2: Add the cross-platform launcher.

Create scripts/run-electron-vitest.mjs with this implementation:

~~~js
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const bin = process.platform === "win32" ? "electron.cmd" : "electron";
const electron = path.join(process.cwd(), "node_modules", ".bin", bin);
const inherited = process.env.NODE_OPTIONS?.trim();
const nodeOptions = [inherited, "--experimental-require-module"]
  .filter(Boolean)
  .join(" ");

const result = spawnSync(
  electron,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: nodeOptions,
    },
  },
);

if (result.error) {
  console.error(`Unable to start Electron test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
~~~

Change package.json to:

~~~json
"test:core": "node scripts/run-electron-vitest.mjs --project core"
~~~

- [ ] Step 3: Run the focused command and the full unit command.

~~~powershell
npm run test:core
npm test
~~~

Expected: the shell-assignment error is gone; core tests report their actual Windows failures; the renderer project still runs after core completes. Do not change unrelated core assertions in this task.

- [ ] Step 4: Commit.

~~~powershell
git add scripts/run-electron-vitest.mjs package.json
git commit -m "test: make electron vitest runner cross-platform"
~~~

## Task 2: Add the pure portable layout resolver

**Files:**
- Create: electron/core/portablePaths.ts
- Create: electron/core/__tests__/portablePaths.test.ts
- Modify: .gitignore
- Modify: electron/core/paths.ts
- Modify: electron/core/index.ts

- [ ] Step 1: Write failing resolver tests.

Create tests for the public behavior below:

~~~ts
it("resolves a packaged App directory to its portable parent", () => {
  const layout = resolvePortableLayout({
    appPath: "D:/PortableVideoLibrary/App/resources/app.asar",
    executablePath: "D:/PortableVideoLibrary/App/PortableVideoLibrary.exe",
    isPackaged: true,
  });

  expect(layout.rootDir).toBe(path.resolve("D:/PortableVideoLibrary"));
  expect(layout.appDir).toBe(path.resolve("D:/PortableVideoLibrary/App"));
  expect(layout.dataDir).toBe(path.resolve("D:/PortableVideoLibrary/Data"));
  expect(layout.mediaDir).toBe(path.resolve("D:/PortableVideoLibrary/Media"));
});

it("uses an explicit override for tests and development", () => {
  const layout = resolvePortableLayout({
    appPath: "D:/Projects/PortableVideoLibrary",
    executablePath: "D:/Applications/electron.exe",
    isPackaged: false,
    portableRootOverride: "C:/Temp/portable-fixture",
  });

  expect(layout.rootDir).toBe(path.resolve("C:/Temp/portable-fixture"));
  expect(layout.dataDir).toBe(path.resolve("C:/Temp/portable-fixture/Data"));
});

it("rejects relative workspace locators that escape Media", () => {
  const layout = layoutForRoot("D:/PortableVideoLibrary");
  expect(() =>
    resolveWorkspaceLocator(layout, {
      kind: "portable-relative",
      value: "../outside",
    }),
  ).toThrow("workspace locator escapes media root");
});
~~~

- [ ] Step 2: Run the focused tests and verify RED.

~~~powershell
npx vitest run electron/core/__tests__/portablePaths.test.ts --project core
~~~

Expected: FAIL because portablePaths.ts and its exports do not exist.

- [ ] Step 3: Implement the minimal pure API.

Define these strict types and functions without importing Electron:

~~~ts
export type WorkspaceLocator =
  | { kind: "portable-relative"; value: string }
  | { kind: "absolute"; value: string };

export interface PortableLayout {
  rootDir: string;
  appDir: string;
  dataDir: string;
  mediaDir: string;
  configPath: string;
  databasePath: string;
  assetsDir: string;
  playlistsDir: string;
  backupsDir: string;
  logsDir: string;
  tempDir: string;
}

export interface PortableLayoutInput {
  appPath: string;
  executablePath: string;
  isPackaged: boolean;
  portableRootOverride?: string;
  portableExecutableDir?: string;
}

export function resolvePortableLayout(input: PortableLayoutInput): PortableLayout;
export function resolveWorkspaceLocator(
  layout: PortableLayout,
  locator: WorkspaceLocator,
): string;
export function ensurePortableDirectories(layout: PortableLayout): void;
~~~

Rules: an explicit override wins; otherwise PORTABLE_EXECUTABLE_DIR wins; a packaged executable inside App uses its parent as the root; development uses <appPath>/.portable-dev; relative locators are resolved under Media and rejected when normalized containment escapes that directory. ensurePortableDirectories creates only Data, its child directories, and Media; it never creates a fallback userData database.

Update paths.ts and Core to accept a PortableLayout/data-directory dependency instead of calling app.getPath("userData") inside pure path helpers. Add .portable-dev/ and Data/ to .gitignore.

- [ ] Step 4: Run focused and existing path tests.

~~~powershell
npx vitest run electron/core/__tests__/portablePaths.test.ts --project core
npx vitest run electron/core/__tests__/paths.test.ts --project core
npm run typecheck
~~~

Expected: new tests pass; existing POSIX-specific failures remain recorded until their platform assumptions are handled separately; typecheck exits 0.

- [ ] Step 5: Commit.

~~~powershell
git add electron/core/portablePaths.ts electron/core/__tests__/portablePaths.test.ts electron/core/paths.ts electron/core/index.ts .gitignore
git commit -m "feat: add portable data layout resolver"
~~~

## Task 3: Introduce checksummed schema migrations and consistent backups

**Files:**
- Create: electron/core/migrations.ts
- Create: electron/core/backups.ts
- Create: electron/core/__tests__/migrations.test.ts
- Create: electron/core/__tests__/backups.test.ts
- Modify: electron/core/db.ts

- [ ] Step 1: Write migration and backup tests.

The tests must prove all of the following against temporary SQLite files:

~~~ts
it("records a legacy baseline and applies a new migration once", () => {
  const db = openLegacyFixtureDb();
  applyMigrations(db, { now: () => 1_700_000_000 });
  expect(db.prepare("SELECT version FROM schema_migrations").all()).toEqual([
    { version: 0 },
    { version: 1 },
  ]);
  applyMigrations(db, { now: () => 1_700_000_001 });
  expect(db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get())
    .toEqual({ count: 2 });
});

it("rejects a changed checksum instead of silently accepting a migration", () => {
  const db = openMigratedFixtureDb();
  expect(() => applyMigrations(db, { registry: changedRegistry }))
    .toThrow("migration checksum mismatch");
});

it("leaves the original schema when a migration fails", () => {
  const db = openLegacyFixtureDb();
  expect(() => applyMigrations(db, { registry: failingRegistry }))
    .toThrow("migration failed");
  expect(
    db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='files'",
    ).get(),
  ).toEqual({ name: "files" });
});

it("publishes a WAL-consistent snapshot and manifest atomically", async () => {
  const result = await createBackup({
    db,
    configPath,
    backupsDir,
    appVersion: "0.8.0",
  });
  expect(result.manifest.schemaVersion).toBeGreaterThanOrEqual(0);
  expect(fs.existsSync(result.databasePath)).toBe(true);
  expect(fs.existsSync(result.configPath)).toBe(true);
  expect(fs.readdirSync(backupsDir).every((name) => !name.endsWith(".tmp")))
    .toBe(true);
});
~~~

- [ ] Step 2: Run the new tests and verify RED.

~~~powershell
npx vitest run electron/core/__tests__/migrations.test.ts electron/core/__tests__/backups.test.ts --project core
~~~

Expected: FAIL because the migration and backup modules do not exist.

- [ ] Step 3: Implement the migration registry.

Use these interfaces:

~~~ts
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

export function applyMigrations(
  db: DB,
  options?: {
    context?: MigrationContext;
    registry?: MigrationRegistry;
  },
): void;
~~~

applyMigrations first creates only the metadata table:

~~~sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
~~~

For a database without this table, validate the required legacy tables and insert a version=0 baseline with checksum legacy-baseline-v1. For each registered step, compute SHA-256 over version + newline + name + newline + sql, compare existing rows, and run the step plus its metadata insert inside one SQLite transaction. A missing step or checksum mismatch throws a typed error before any later step runs. openDb must call this runner after opening the connection and enabling WAL/foreign keys, before any read-only worker handle is opened.

The first real step creates a portable_metadata table containing layout_version, app_version, and last_backup_id; it must not rename or delete existing media tables. This gives Data initialization a durable marker without prematurely introducing the phase 2 identity schema.

- [ ] Step 4: Implement consistent backups.

createBackup must:

1. Create Data/backups/<timestamp>-<uuid>.tmp.
2. Use better-sqlite3's backup API, or an equivalent SQLite-consistent snapshot, to copy the database including WAL state into the temporary file.
3. Copy config.json to a temporary sibling file.
4. Compute SHA-256 and byte size for both snapshots.
5. Write a manifest containing backup ID, app version, schema version, database/config hashes, sizes, and creation time.
6. Rename temporary files to final names only after validation; never leave a final manifest pointing at a partial snapshot.

Expose validateBackup and restoreBackup as pure-service APIs. Restore copies to a new temporary Data location, validates hashes, closes active DB handles, then atomically replaces the target files; it never deletes the only known-good backup before replacement succeeds.

- [ ] Step 5: Run migration, backup, and regression tests.

~~~powershell
npx vitest run electron/core/__tests__/migrations.test.ts electron/core/__tests__/backups.test.ts --project core
npm run test:core
npm run typecheck
~~~

Expected: focused tests pass, the core suite reaches its real platform-dependent assertions, and typecheck exits 0.

- [ ] Step 6: Commit.

~~~powershell
git add electron/core/migrations.ts electron/core/backups.ts electron/core/__tests__/migrations.test.ts electron/core/__tests__/backups.test.ts electron/core/db.ts
git commit -m "feat: add checksummed database migrations and backups"
~~~

## Task 4: Migrate config and workspace locators without breaking old data

**Files:**
- Create: electron/core/__tests__/portableRecovery.test.ts
- Modify: electron/core/appConfig.ts
- Modify: electron/core/workspaces.ts
- Modify: electron/core/portableRecovery.ts
- Modify: electron/core/paths.ts
- Modify: electron/core/index.ts
- Modify: shared/ipc/schema.ts and shared/workspaceIds.ts only if the stable workspace record changes the public ID constraint

- [ ] Step 1: Write failing legacy-import tests.

Cover these concrete scenarios:

~~~ts
it("imports legacy userData into Data without deleting the source", async () => {
  const fixture = await createLegacyUserDataFixture({
    root: "E:/Media/柯南",
    config: { roots: ["E:/Media/柯南"] },
  });
  const result = await importLegacyUserData(fixture.options);
  expect(result.status).toBe("migrated");
  expect(fs.existsSync(fixture.legacyConfigPath)).toBe(true);
  expect(fs.existsSync(path.join(fixture.dataDir, "config.json"))).toBe(true);
});

it("stores a root below Media as a portable-relative locator", () => {
  const record = locatorForResolvedRoot(layout, "E:/PortableVideoLibrary/Media/柯南");
  expect(record).toEqual({ kind: "portable-relative", value: "柯南" });
});

it("keeps an external root explicitly non-portable", () => {
  const record = locatorForResolvedRoot(layout, "C:/Videos/other");
  expect(record).toEqual({ kind: "absolute", value: "C:/Videos/other" });
});

it("reruns an interrupted import idempotently", async () => {
  await importLegacyUserData(fixture.options);
  const second = await importLegacyUserData(fixture.options);
  expect(second.status).toBe("already-current");
});
~~~

- [ ] Step 2: Run the focused tests and verify RED.

~~~powershell
npx vitest run electron/core/__tests__/portableRecovery.test.ts --project core
~~~

Expected: FAIL because the import and locator APIs do not exist.

- [ ] Step 3: Define the backward-compatible config format.

Keep parsing the existing roots: string[] form, but write version 2 records in this shape:

~~~ts
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
  update: UpdateConfig;
}
~~~

The reader accepts V1 roots and synthesizes records deterministically during migration. A root inside the resolved Media directory stores the normalized path relative to Media; every other root stores an absolute locator and is marked non-portable in recovery/reporting. Preserve the old path hash as legacyPathHash so existing Data/roots/<hash> data can be moved without guessing.

Keep the existing IPC behavior stable inside this task: Workspaces resolves a WorkspaceConfig to an absolute path before constructing Core, and collection entries continue to use the current workspace/file reference shape. Do not introduce video_id or change file identity here.

- [ ] Step 4: Implement copy-first import and idempotency.

importLegacyUserData must:

1. Acquire a process-local import lock.
2. Create Data/temp/import-<uuid> and a manifest describing each source file.
3. Copy the legacy config and every registered root data directory into the new Data layout, preserving SQLite WAL/-shm through the backup service rather than raw partial copies.
4. Validate file sizes and hashes.
5. Publish the new config and manifest atomically.
6. Leave legacy userData intact until a later explicit cleanup action.

If any copy, hash, schema open, or validation fails, remove only the temporary import directory and return a recovery status; never overwrite a valid Data directory.

- [ ] Step 5: Run migration and workspace tests.

~~~powershell
npx vitest run electron/core/__tests__/portableRecovery.test.ts electron/core/__tests__/portablePaths.test.ts --project core
npm run test:core
npm run typecheck
~~~

Expected: new tests pass; old workspace and collection tests remain green except for the already-recorded platform-specific baseline failures.

- [ ] Step 6: Commit.

~~~powershell
git add electron/core/portableRecovery.ts electron/core/__tests__/portableRecovery.test.ts electron/core/appConfig.ts electron/core/workspaces.ts electron/core/paths.ts electron/core/index.ts shared/ipc/schema.ts shared/workspaceIds.ts
git commit -m "feat: persist portable workspace locators"
~~~

## Task 5: Add explicit startup recovery state and UI

**Files:**
- Modify: electron/main.ts
- Modify: electron/preload.ts
- Modify: shared/ipc/channelNames.ts
- Modify: shared/ipc/channels.ts
- Modify: shared/ipc/schema.ts
- Modify: src/ipc/client.ts
- Modify: src/App.tsx or the existing startup route
- Modify: src/i18n/locales/ja.ts, en.ts, es.ts, fr.ts, ko.ts, zh-CN.ts
- Create or modify: e2e/portable-data.spec.ts

- [ ] Step 1: Write failing IPC/UI tests.

Define the recovery DTO before the UI:

~~~ts
export const RecoveryStatusSchema = z.object({
  state: z.enum([
    "ready",
    "needs-initialization",
    "migration-failed",
    "restore-available",
  ]),
  dataDir: z.string(),
  messageCode: z.string(),
  backupIds: z.array(z.string()),
});
~~~

Add E2E assertions that a missing Data directory shows initialization/recovery actions, that the normal portable package opens the library, and that no second database is created below Electron userData.

- [ ] Step 2: Run the focused E2E test and verify RED.

~~~powershell
npx playwright test e2e/portable-data.spec.ts
~~~

Expected: FAIL because startup currently always assumes userData and has no recovery surface.

- [ ] Step 3: Implement main-process startup gating.

Startup order must be:

~~~ts
const layout = resolvePortableLayout(runtimeInputs);
const recovery = await preparePortableData(layout);
if (recovery.state !== "ready") {
  registerRecoveryIpc(recovery);
  createWindow();
  loadRecoveryPage(mainWindow, recovery);
  return;
}
const ws = new Workspaces({ layout, recovery });
~~~

The normal path calls ensurePortableDirectories, imports legacy data if needed, creates a pre-migration backup, applies migrations, then opens Core/query-worker handles. The error path never opens the old DB and never creates a new database in app.getPath("userData").

Add only these operations to IPC: read recovery status, list validated backups, restore a selected backup, and retry initialization. Inputs are IDs from the validated manifest, not arbitrary paths. All actions return typed status and stable error codes.

- [ ] Step 4: Implement the recovery page and locale keys.

The page shows the resolved Data directory, the failure reason, backup timestamps, and exactly one primary action for the current state: initialize, retry, or restore. It must not offer destructive deletion of legacy data. Update all six locale files with matching keys and run the existing locale consistency tests.

- [ ] Step 5: Run tests.

~~~powershell
npx playwright test e2e/portable-data.spec.ts
npm run test:renderer
npm run typecheck
~~~

Expected: portable startup/recovery E2E passes, renderer tests pass, and typecheck exits 0.

- [ ] Step 6: Commit.

~~~powershell
git add electron/main.ts electron/preload.ts shared/ipc src/App.tsx src/ipc/client.ts src/i18n/locales e2e/portable-data.spec.ts
git commit -m "feat: add portable startup recovery"
~~~

## Task 6: Validate portable packaging, upgrade safety, and documentation

**Files:**
- Modify: package.json only if the portable artifact needs an explicit output/layout script.
- Modify: docs/README.md
- Modify: docs/data-model.md
- Modify: docs/build-and-ci.md
- Modify: README.md
- Modify: e2e/portable-data.spec.ts

- [ ] Step 1: Add an end-to-end artifact assertion.

The smoke test must assert that the built package contains the executable and resources, while Data is created beside App at first launch. It must assert that replacing only App leaves Data/config.json and the database hash unchanged.

- [ ] Step 2: Run the full phase 1 verification set.

~~~powershell
npm run typecheck
npm run test:core
npm run test:renderer
npm run test:e2e
npm run dist -- --win portable
npx playwright test e2e/portable-data.spec.ts
~~~

Expected: all commands exit 0. Any remaining platform or upstream failure must be reported with its exact command and not hidden by a workaround.

- [ ] Step 3: Verify the artifact and data separation manually.

Use a clean temporary directory containing:

~~~text
PortableVideoLibrary/
├─ App/PortableVideoLibrary.exe
├─ Data/
└─ Media/柯南/sample.mp4
~~~

Start the app, scan Media, close it, copy the entire directory to a different drive letter or a path-equivalent test root, replace only App, and start again. Verify that the same workspace locator, database, metadata, and thumbnails are readable. If a true second drive is unavailable, document the exact substitute and mark the physical-drive check pending rather than claiming it passed.

- [ ] Step 4: Update the developer/user docs.

Document the canonical layout, first-launch initialization, backup contents, migration failure behavior, restore procedure, external-media non-portable rule, and the distinction between the development .portable-dev root and the release PortableVideoLibrary root.

- [ ] Step 5: Commit.

~~~powershell
git add package.json docs README.md e2e/portable-data.spec.ts
git commit -m "docs: document portable data and recovery workflow"
~~~

## Completion checklist for phase 1

- [ ] origin remains the user Fork and upstream remains the original repository.
- [ ] No normal runtime write creates a second database under Electron userData.
- [ ] Portable-relative workspace roots resolve after a drive-letter change.
- [ ] External workspace roots remain explicit and marked non-portable.
- [ ] Existing userData data is copied, verified, and retained until the user removes it.
- [ ] Every schema migration has a version and checksum; checksum mismatch stops writes.
- [ ] A pre-migration SQLite/config backup can be validated and restored.
- [ ] Recovery UI is available for missing Data and migration failure.
- [ ] All new behavior has a failing test observed before implementation and a passing regression run afterward.
- [ ] Typecheck, core, renderer, E2E, portable packaging, and portable smoke results are recorded with fresh exit codes.
