# Phase 2.1 Stable Identity and Incremental Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a stable UUID-based media identity, versioned `quick-v1` fingerprints, durable scan runs, and a persistent issue queue while preserving the existing `files`-based UI and IPC contracts.

**Architecture:** Keep `files` as the physical-file compatibility model and add `files.video_id` as its identity projection. Store logical identities, current file fingerprints, scan runs, and scan issues in versioned SQLite tables; keep identity matching in pure functions and put database mutations behind focused query/service modules. Extend the existing scan pipeline after physical synchronization, reusing the current ffprobe result for fingerprint metadata and leaving FTS, thumbnails, tags, history, and renderer DTOs unchanged.

**Tech Stack:** TypeScript, Electron main process, better-sqlite3, SQLite WAL, Node.js `crypto`/`fs/promises`, Vitest through the Electron test runner, existing ffprobe/thumbnail pipeline.

---

## File map and responsibilities

Create the following focused modules:

- `electron/core/fingerprint.ts` — `quick-v1` constants, file-byte sampling, metadata normalization, stream-signature canonicalization, and fingerprint-key generation.
- `electron/core/identity.ts` — pure candidate aggregation and identity decision rules; no SQLite or filesystem imports.
- `electron/core/scanService.ts` — asynchronous preparation plus transactional persistence of fingerprints, logical identities, and issues for a scan.
- `electron/core/queries/identity.ts` — SQLite reads/writes for `videos`, `fingerprints`, `scan_runs`, and `scan_issues`.
- `electron/core/__tests__/fingerprint.test.ts` — deterministic fingerprint tests.
- `electron/core/__tests__/identity.test.ts` — pure identity decision tests.
- `electron/core/__tests__/identityQueries.test.ts` — schema repository and scan-run lifecycle tests.
- `electron/core/__tests__/scanService.test.ts` — file binding, replacement, duplicate, conflict, and issue persistence tests.
- `electron/core/__tests__/jobsIdentity.test.ts` — `runScan()` lifecycle and pipeline integration tests with deterministic media mocks.

Modify these existing files:

- `electron/core/db.ts` — add the compatibility `files.video_id` column to the canonical DDL and idempotent legacy backfill.
- `electron/core/migrations.ts` — add the checksummed identity migration and conservative one-to-one initialization for legacy rows.
- `electron/core/queries.ts` — re-export `queries/identity.ts` without changing existing import paths.
- `electron/core/scan.ts` — return identity targets and move conflicts, remove first-candidate move selection, and create provisional identities transactionally for inserted/replaced rows.
- `electron/core/jobs.ts` — create/finalize `scan_runs`, reconcile identity targets, persist issues, and preserve existing derived-task behavior.
- `electron/core/__tests__/db.test.ts` and `electron/core/__tests__/migrations.test.ts` — schema, migration, rebuild-preservation, and idempotency coverage.
- `electron/core/__tests__/scan.test.ts` — multi-candidate move regression coverage and identity-target expectations.
- `docs/portable-video-library-phase-0-audit.md` — update the phase 2.1 implementation status after verification.

Do not modify `shared/ipc/schema.ts`, `shared/ipc/channels.ts`, renderer DTOs, or the existing tag/history/collection query contracts in this phase.

## Task 1: Add the versioned identity schema and legacy backfill

**Files:**
- Modify: `electron/core/db.ts:43-59,187-215`
- Modify: `electron/core/migrations.ts:1-70`
- Test: `electron/core/__tests__/db.test.ts`
- Test: `electron/core/__tests__/migrations.test.ts`

- [ ] **Step 1: Write the failing schema and legacy-backfill tests.**

Add these assertions to the existing database/migration suites:

```ts
it("creates the phase 2 identity tables and files.video_id", () => {
  const db = openDb(":memory:");
  expect(tableColumns(db, "files")).toContain("video_id");
  for (const table of ["videos", "fingerprints", "scan_runs", "scan_issues"]) {
    expect(
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).get(table),
    ).toEqual({ name: table });
  }
  expect(
    db.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
  ).toEqual([{ version: 0 }, { version: 1 }, { version: 2 }]);
  db.close();
});

it("gives legacy file rows one stable identity without merging them", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-v2-"));
  const file = path.join(directory, "legacy.sqlite");
  const seed = new Database(file);
  seed.exec(`
    CREATE TABLE scan_roots (id INTEGER PRIMARY KEY, path TEXT NOT NULL, path_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE files (id INTEGER PRIMARY KEY, root_id INTEGER NOT NULL, rel_path TEXT NOT NULL, abs_path TEXT NOT NULL, kind TEXT NOT NULL, deleted_at INTEGER, created_at INTEGER NOT NULL);
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
  ).toEqual(rows.map((row, index) => ({ id: [7, 9][index], video_id: row.video_id })));
  secondOpen.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
```

Use the existing file-backed fixture pattern in `migrations.test.ts`; do not use an in-memory database for the reopen assertion. The test must also reopen a second time and assert the two UUIDs are unchanged.

- [ ] **Step 2: Run only the new tests and verify they fail for the missing schema.**

Run:

```text
npm run test:core -- electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts
```

Expected: FAIL because `files.video_id`, the phase 2 tables, and migration version `2` do not exist.

- [ ] **Step 3: Add the canonical column, migration SQL, and conservative backfill.**

In `db.ts`, add `video_id TEXT` to `FILES_DDL`, and in `backfillColumns()` add it when missing before creating `idx_files_video_id`. Keeping the column in `FILES_DDL` is required so `migrateKindCheck()` carries it through a legacy `files` table rebuild.

In `migrations.ts`, add a checksummed version 2 step after `portable-metadata-v1`. Its SQL must create the four tables and indexes with these constraints:

```sql
CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('video','image','audio')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','missing')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  missing_at INTEGER
);
CREATE TABLE IF NOT EXISTS fingerprints (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  algorithm TEXT NOT NULL,
  version TEXT NOT NULL,
  fingerprint_key TEXT NOT NULL,
  size INTEGER NOT NULL,
  duration_ms INTEGER,
  first_hash TEXT,
  last_hash TEXT,
  full_hash TEXT,
  stream_signature TEXT NOT NULL,
  computed_at INTEGER NOT NULL,
  UNIQUE (file_id, algorithm, version)
);
CREATE INDEX IF NOT EXISTS idx_fingerprints_key
  ON fingerprints(algorithm, version, fingerprint_key);
CREATE TABLE IF NOT EXISTS scan_runs (
  run_id TEXT PRIMARY KEY,
  root_id INTEGER NOT NULL REFERENCES scan_roots(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running','completed','aborted','failed')),
  phase TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  stats_json TEXT,
  error_code TEXT,
  error_detail TEXT
);
CREATE TABLE IF NOT EXISTS scan_issues (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES scan_runs(run_id) ON DELETE CASCADE,
  file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning','error')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','ignored')),
  candidate_video_ids_json TEXT,
  details_json TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_scan_issues_run_status
  ON scan_issues(run_id, status);
CREATE INDEX IF NOT EXISTS idx_scan_issues_file_status
  ON scan_issues(file_id, status);
```

The migration apply function must first ensure `files.video_id` exists for direct `applyMigrations()` callers, then query every legacy row whose `video_id` is NULL. For each row, call `randomUUID()`, insert one `videos` row with `active` or `missing` derived from `deleted_at`, and update the `files` row in the same transaction. Do not read media files or create fingerprints during migration. Use the migration context clock for all timestamps.

- [ ] **Step 4: Run the schema and migration tests to verify they pass.**

Run:

```text
npm run test:core -- electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts
```

Expected: PASS, including the existing audio-check, FTS, and migration-checksum regressions.

- [ ] **Step 5: Commit the schema foundation.**

```text
git add electron/core/db.ts electron/core/migrations.ts electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts
git commit -m "feat: add phase2 identity schema migration"
```

## Task 2: Implement and test the pure `quick-v1` fingerprint module

**Files:**
- Create: `electron/core/fingerprint.ts`
- Create: `electron/core/__tests__/fingerprint.test.ts`
- Reference: `electron/core/media.ts:14-22,80-147`

- [ ] **Step 1: Write failing tests for byte sampling and canonical metadata.**

The test file must cover the small-file/full-hash branch, the large-file first/last-window branch, a changed tail, duration normalization, stable stream-signature ordering, and expected-size drift. Use a temporary directory and a deterministic buffer larger than `8 * 1024 * 1024`:

```ts
it("hashes a small file as a full file and is independent of its path", async () => {
  const a = path.join(dir, "a.mp4");
  const b = path.join(dir, "renamed.mp4");
  await fsp.writeFile(a, Buffer.from("same bytes"));
  await fsp.copyFile(a, b);
  const first = await quickFingerprint(a, meta("video"));
  const second = await quickFingerprint(b, meta("video"));
  expect(first.fullHash).toMatch(/^[0-9a-f]{64}$/);
  expect(first.firstHash).toBe(first.fullHash);
  expect(first.lastHash).toBe(first.fullHash);
  expect(second.fingerprintKey).toBe(first.fingerprintKey);
});

it("uses the first and last 4 MiB for a large file", async () => {
  const file = path.join(dir, "large.mp4");
  const data = Buffer.alloc(8 * 1024 * 1024 + 1, 0x41);
  data[data.length - 1] = 0x42;
  await fsp.writeFile(file, data);
  const result = await quickFingerprint(file, meta("video"));
  expect(result.fullHash).toBeNull();
  expect(result.firstHash).toMatch(/^[0-9a-f]{64}$/);
  expect(result.lastHash).toMatch(/^[0-9a-f]{64}$/);
});

it("rejects a file whose size changed during the fingerprint request", async () => {
  const file = path.join(dir, "drift.mp4");
  await fsp.writeFile(file, "bytes");
  await expect(quickFingerprint(file, meta("video"), 999)).rejects.toMatchObject({
    code: "file-changed-during-read",
  });
});

it("normalizes duration and stream metadata into a stable key", () => {
  const a = buildFingerprintKey({ ...meta("video"), duration: 1.2344, fps: 29.97 });
  const b = buildFingerprintKey({ ...meta("video"), duration: 1.23449, fps: 29.97001 });
  expect(a.durationMs).toBe(1234);
  expect(a.streamSignature).toBe(b.streamSignature);
  expect(a.fingerprintKey).toBe(b.fingerprintKey);
});
```

Define `meta(kind)` in the test as a complete `FingerprintMetadata` object with explicit nulls so omission of unknown values is detected.

- [ ] **Step 2: Run the fingerprint tests and verify the module is missing.**

Run:

```text
npm run test:core -- electron/core/__tests__/fingerprint.test.ts
```

Expected: FAIL because `fingerprint.ts` and `quickFingerprint()` do not exist.

- [ ] **Step 3: Implement the fingerprint module with one source of truth for constants.**

Export these exact types and functions:

```ts
export const FINGERPRINT_ALGORITHM = "quick" as const;
export const FINGERPRINT_VERSION = "v1" as const;
export const FINGERPRINT_WINDOW_BYTES = 4 * 1024 * 1024;
export const FINGERPRINT_FULL_HASH_MAX_BYTES = 8 * 1024 * 1024;

export interface FingerprintMetadata {
  kind: Kind;
  duration: number | null;
  codec: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
}

export interface QuickFingerprint {
  algorithm: typeof FINGERPRINT_ALGORITHM;
  version: typeof FINGERPRINT_VERSION;
  size: number;
  durationMs: number | null;
  firstHash: string | null;
  lastHash: string | null;
  fullHash: string | null;
  streamSignature: string;
  fingerprintKey: string;
}

export async function quickFingerprint(
  file: string,
  metadata: FingerprintMetadata,
  expectedSize?: number,
): Promise<QuickFingerprint>;

export function buildFingerprintKey(
  metadata: FingerprintMetadata,
  bytes?: Pick<QuickFingerprint, "size" | "firstHash" | "lastHash" | "fullHash">,
): QuickFingerprint;
```

Use `fs/promises.open`, verify the observed size against `expectedSize` when supplied, hash small files once, and hash large-file windows independently. Normalize duration with `Math.round(Math.max(duration, 0) * 1000)`, normalize FPS to `Math.round(Math.max(fps, 0) * 1000)`, and build `streamSignature` from `JSON.stringify({ kind, codec, width, height, fpsMilli })` with the object keys in that order. Build the final key from the exact seven-element JSON array in the approved design and hash its UTF-8 bytes with SHA-256.

- [ ] **Step 4: Run the fingerprint tests and the adjacent media tests.**

Run:

```text
npm run test:core -- electron/core/__tests__/fingerprint.test.ts electron/core/__tests__/media.test.ts
```

Expected: PASS, with existing media extraction behavior unchanged.

- [ ] **Step 5: Commit the fingerprint module.**

```text
git add electron/core/fingerprint.ts electron/core/__tests__/fingerprint.test.ts
git commit -m "feat: add versioned quick media fingerprints"
```

## Task 3: Implement pure identity decisions

**Files:**
- Create: `electron/core/identity.ts`
- Create: `electron/core/__tests__/identity.test.ts`

- [ ] **Step 1: Write failing decision-table tests.**

Cover these cases with a table-driven suite:

```ts
const cases = [
  {
    name: "keeps an unchanged physical row",
    input: { currentVideoId: "v-old", previousKey: "k", currentKey: "k", candidates: [], strong: true },
    expected: { kind: "keep", videoId: "v-old" },
  },
  {
    name: "reuses one strong logical candidate",
    input: { currentVideoId: "v-new", previousKey: null, currentKey: "k", candidates: [{ videoId: "v-existing", strong: true }], strong: true },
    expected: { kind: "reuse", videoId: "v-existing" },
  },
  {
    name: "creates a new identity without candidates",
    input: { currentVideoId: "v-provisional", previousKey: null, currentKey: "k", candidates: [], strong: true },
    expected: { kind: "create", videoId: "v-provisional" },
  },
  {
    name: "does not choose the first of multiple candidates",
    input: { currentVideoId: "v-provisional", previousKey: null, currentKey: "k", candidates: [{ videoId: "v-a", strong: true }, { videoId: "v-b", strong: true }], strong: true },
    expected: { kind: "conflict", issueType: "ambiguous_identity", candidateVideoIds: ["v-a", "v-b"] },
  },
  {
    name: "does not auto-bind weak evidence",
    input: { currentVideoId: "v-provisional", previousKey: null, currentKey: "k", candidates: [{ videoId: "v-a", strong: false }], strong: false },
    expected: { kind: "conflict", issueType: "probe_failed", candidateVideoIds: ["v-a"] },
  },
];
```

Add a replacement assertion: when `previousKey !== currentKey`, the result must never be `keep`, even if `currentVideoId` is present.

- [ ] **Step 2: Run the decision tests and verify the module is missing.**

Run:

```text
npm run test:core -- electron/core/__tests__/identity.test.ts
```

Expected: FAIL because `identity.ts` does not exist.

- [ ] **Step 3: Implement the pure decision API.**

Export these exact types and functions:

```ts
export interface IdentityCandidate {
  videoId: string;
  strong: boolean;
}

export interface IdentityDecisionInput {
  currentVideoId: string;
  previousKey: string | null;
  currentKey: string;
  candidates: readonly IdentityCandidate[];
  strong: boolean;
}

export type IdentityDecision =
  | { kind: "keep" | "reuse" | "create"; videoId: string }
  | {
      kind: "conflict";
      issueType: "ambiguous_identity" | "duplicate_candidate" | "probe_failed";
      candidateVideoIds: string[];
    };

export function decideIdentity(input: IdentityDecisionInput): IdentityDecision;
```

Deduplicate candidates by `videoId` before counting them. Return `keep` only when the previous and current keys are equal and the current evidence is strong. Return `reuse` only for exactly one strong logical candidate. Return `conflict` for weak evidence or multiple logical candidates, preserving candidate IDs in deterministic lexical order. Never mutate the input.

- [ ] **Step 4: Run the pure decision tests.**

Run:

```text
npm run test:core -- electron/core/__tests__/identity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the pure identity domain.**

```text
git add electron/core/identity.ts electron/core/__tests__/identity.test.ts
git commit -m "feat: add deterministic media identity decisions"
```

## Task 4: Add focused SQLite repositories for identities, scans, and issues

**Files:**
- Create: `electron/core/queries/identity.ts`
- Modify: `electron/core/queries.ts:3-11`
- Create: `electron/core/__tests__/identityQueries.test.ts`

- [ ] **Step 1: Write failing repository tests.**

Cover a scan-run lifecycle and the identity repository in one in-memory database:

```ts
it("creates and finalizes a scan run with JSON stats", () => {
  const { db, rootId } = newDb();
  const runId = "run-1";
  createScanRun(db, rootId, runId, 100);
  updateScanRunPhase(db, runId, "fingerprint");
  finishScanRun(db, runId, "completed", { inserted: 1, issues: 0 }, 120);
  expect(db.prepare("SELECT * FROM scan_runs WHERE run_id = ?").get(runId)).toMatchObject({
    run_id: "run-1",
    status: "completed",
    phase: "fingerprint",
    started_at: 100,
    finished_at: 120,
    stats_json: JSON.stringify({ inserted: 1, issues: 0 }),
  });
});

it("records an issue with deterministic candidate JSON", () => {
  const { db, rootId } = newDb();
  createScanRun(db, rootId, "run-1", 100);
  const id = recordScanIssue(db, {
    runId: "run-1",
    fileId: null,
    issueType: "ambiguous_identity",
    severity: "warning",
    candidateVideoIds: ["v-b", "v-a"],
    details: { relPath: "clip.mp4" },
    now: 101,
  });
  expect(db.prepare("SELECT candidate_video_ids_json, details_json FROM scan_issues WHERE id = ?").get(id))
    .toEqual({ candidate_video_ids_json: '["v-b","v-a"]', details_json: '{"relPath":"clip.mp4"}' });
});

it("upserts one current fingerprint per file and finds candidates excluding the file", () => {
  const { db, rootId } = newDb();
  const first = insertFile(db, rootId, { relPath: "a.mp4", contentHash: "legacy-a" });
  const second = insertFile(db, rootId, { relPath: "b.mp4", contentHash: "legacy-b" });
  createVideoForFile(db, first, "video", "v-a", 100);
  createVideoForFile(db, second, "video", "v-b", 100);
  upsertFingerprint(db, fingerprintRow(first, "key", 100));
  upsertFingerprint(db, fingerprintRow(second, "key", 100));
  expect(findFingerprintCandidates(db, "key", first)).toEqual([{ videoId: "v-b", strong: true }]);
});
```

Define the three test helpers used above in `identityQueries.test.ts` so the snippet is executable:

```ts
function createVideoForFile(db: DB, fileId: number, kind: Kind, videoId: string, now: number): void {
  db.prepare(
    "INSERT INTO videos (video_id, kind, status, created_at, updated_at, last_seen_at) VALUES (?, ?, 'active', ?, ?, ?)",
  ).run(videoId, kind, now, now, now);
  db.prepare("UPDATE files SET video_id = ? WHERE id = ?").run(videoId, fileId);
}

function fingerprintRow(fileId: number, key: string, now: number): FingerprintRow {
  return {
    fileId,
    algorithm: "quick",
    version: "v1",
    fingerprintKey: key,
    size: 10,
    durationMs: 1000,
    firstHash: "a".repeat(64),
    lastHash: "b".repeat(64),
    fullHash: null,
    streamSignature: '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}',
    computedAt: now,
  };
}

```

Use the existing `DB`, `Kind`, `FingerprintRow`, and `newDb()` imports; keep helpers local to the test file.

- [ ] **Step 2: Run the repository tests and verify the exports are missing.**

Run:

```text
npm run test:core -- electron/core/__tests__/identityQueries.test.ts
```

Expected: FAIL because the repository module and barrel exports do not exist.

- [ ] **Step 3: Implement the repository API and export it.**

Export these functions:

```ts
export function createScanRun(db: DB, rootId: number, runId: string, now: number): void;
export function updateScanRunPhase(db: DB, runId: string, phase: string): void;
export function finishScanRun(
  db: DB,
  runId: string,
  status: "completed" | "aborted" | "failed",
  stats: unknown,
  finishedAt: number,
  error?: { code: string; detail: string },
): void;
export function recordScanIssue(db: DB, input: ScanIssueInput): number;
export function insertVideo(db: DB, video: VideoRow): void;
export function updateVideoStatus(db: DB, videoId: string, status: "active" | "missing", now: number): void;
export function bindFileVideo(db: DB, fileId: number, videoId: string): void;
export function upsertFingerprint(db: DB, row: FingerprintRow): void;
export function findFingerprintCandidates(db: DB, key: string, excludeFileId: number): IdentityCandidate[];
export function fingerprintForFile(db: DB, fileId: number): FingerprintRow | null;
```

Use bound parameters for every value. Sort candidate rows by `video_id` before returning them. `recordScanIssue()` must JSON-stringify arrays/objects without sorting their caller-provided order. `finishScanRun()` must reject invalid status transitions in code: only `running` may become a terminal status, and a terminal run must not be overwritten.

- [ ] **Step 4: Run repository tests and the existing query suite.**

Run:

```text
npm run test:core -- electron/core/__tests__/identityQueries.test.ts electron/core/__tests__/queries.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the repositories.**

```text
git add electron/core/queries/identity.ts electron/core/queries.ts electron/core/__tests__/identityQueries.test.ts
git commit -m "feat: add scan and identity repositories"
```

## Task 5: Make physical move detection conflict-safe

**Files:**
- Modify: `electron/core/scan.ts:258-330,338-518`
- Modify: `electron/core/__tests__/scan.test.ts`

- [ ] **Step 1: Write failing tests for multiple move candidates and returned targets.**

Extend the `syncFiles lifecycle` suite with this scenario:

```ts
it("does not choose the first old row when one new path matches multiple candidates", async () => {
  await fsp.writeFile(path.join(root, "old-a.mp4"), "same bytes");
  await fsp.writeFile(path.join(root, "old-b.mp4"), "same bytes");
  await rescan();
  await fsp.rm(path.join(root, "old-a.mp4"));
  await fsp.rm(path.join(root, "old-b.mp4"));
  await rescan();

  await fsp.writeFile(path.join(root, "new.mp4"), "same bytes");
  const result = await rescan();
  expect(result.stats.moved).toBe(0);
  expect(result.stats.inserted).toBe(1);
  expect(result.moveConflicts).toHaveLength(1);
  expect(result.moveConflicts[0].candidateIds).toHaveLength(2);
  expect(result.identityTargets).toContainEqual(
    expect.objectContaining({ reason: "inserted" }),
  );
});
```

Keep the existing unique rename assertion and add an assertion that its returned target has `reason: "moved"`.

- [ ] **Step 2: Run the scan tests and verify the current first-candidate behavior fails the new test.**

Run:

```text
npm run test:core -- electron/core/__tests__/scan.test.ts
```

Expected: FAIL because current `syncFiles()` calls `.find()` and returns no `moveConflicts` or `identityTargets`.

- [ ] **Step 3: Extend the sync result and replace first-candidate selection.**

Add these types to `scan.ts`:

```ts
export type IdentityTargetReason = "inserted" | "updated" | "moved" | "legacy";

export interface IdentityTarget {
  fileId: number;
  reason: IdentityTargetReason;
  previousVideoId: string | null;
}

export interface MoveConflict {
  relPath: string;
  size: number;
  legacyHash: string;
  candidateIds: number[];
  candidatePaths: string[];
}
```

Return `identityTargets` and `moveConflicts` from `syncFiles()`. Extend the existing-row lookup to select `video_id`, and extend `IdentityTarget` construction to carry the row's previous identity. The move branch must use all candidates whose old `rel_path` is not in `seen`: exactly one candidate is a move; more than one is a conflict and must insert a new physical row instead of updating any old row. Preserve the old unique move behavior, including kind/ext reclassification.

For inserted rows and changed-content rows, create a provisional UUID with the identity repository and update `files.video_id` in the same chunk transaction. The provisional row is what makes every newly visible physical row identity-addressable even if a later probe is interrupted. For a changed row, create the provisional identity before updating `files.video_id`, include the prior `video_id` in `IdentityTarget.previousVideoId`, and pass the current provisional ID separately when reconciling; identity reconciliation may later reuse another existing identity or leave the new provisional identity in place.

Rows with `video_id IS NULL` and no other change must be returned as `reason: "legacy"` so old databases converge on the first scan.

- [ ] **Step 4: Run scan/core regression tests.**

Run:

```text
npm run test:core -- electron/core/__tests__/scan.test.ts electron/core/__tests__/identityQueries.test.ts
```

Expected: PASS, including unique move tracking, content replacement, deletion, and the new multi-candidate conflict case.

- [ ] **Step 5: Commit conflict-safe physical synchronization.**

```text
git add electron/core/scan.ts electron/core/__tests__/scan.test.ts
git commit -m "fix: make scan move detection conflict-safe"
```

## Task 6: Implement transactional identity reconciliation

**Files:**
- Create: `electron/core/scanService.ts`
- Create: `electron/core/__tests__/scanService.test.ts`
- Modify: `electron/core/queries/identity.ts` if repository primitives need a narrow extension

- [ ] **Step 1: Write failing service tests for binding, replacement, duplicate, and conflict.**

Build a test fixture with `openDb(":memory:")`, one root, and real temporary files. Call the service directly with a fixed `runId` and deterministic metadata. Cover:

```ts
function meta(kind: Kind): ExtractedMeta {
  return {
    width: kind === "video" ? 1920 : null,
    height: kind === "video" ? 1080 : null,
    duration: kind === "video" ? 10 : null,
    codec: kind === "video" ? "h264" : null,
    fps: kind === "video" ? 30 : null,
    capturedAt: null,
    raw: null,
  };
}

function fingerprint(key: string, strong: boolean): QuickFingerprint {
  return {
    algorithm: "quick",
    version: "v1",
    size: 10,
    durationMs: 10_000,
    firstHash: "a".repeat(64),
    lastHash: "b".repeat(64),
    fullHash: null,
    streamSignature: strong
      ? '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}'
      : '{"kind":"video","codec":null,"width":null,"height":null,"fpsMilli":null}',
    fingerprintKey: key,
  };
}

function seedFile(db: DB, rootId: number, relPath: string, videoId: string): number {
  const fileId = insertFile(db, rootId, { relPath, kind: "video", size: 10, mtime: 100 });
  insertVideo(db, { videoId, kind: "video", status: "active", createdAt: 100, updatedAt: 100, lastSeenAt: 100, missingAt: null });
  bindFileVideo(db, fileId, videoId);
  return fileId;
}

function fingerprintRow(fileId: number, key: string, now: number): FingerprintRow {
  return {
    fileId,
    algorithm: "quick",
    version: "v1",
    fingerprintKey: key,
    size: 10,
    durationMs: 10_000,
    firstHash: "a".repeat(64),
    lastHash: "b".repeat(64),
    fullHash: null,
    streamSignature: '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}',
    computedAt: now,
  };
}

function seedFileAndFingerprint(db: DB, rootId: number, relPath: string, videoId: string, key: string): number {
  const fileId = seedFile(db, rootId, relPath, videoId);
  upsertFingerprint(db, fingerprintRow(fileId, key, 100));
  return fileId;
}

function videoIdOf(db: DB, fileId: number): string {
  return (db.prepare("SELECT video_id FROM files WHERE id = ?").get(fileId) as { video_id: string }).video_id;
}

function statusOf(db: DB, videoId: string): string {
  return (db.prepare("SELECT status FROM videos WHERE video_id = ?").get(videoId) as { status: string }).status;
}

function openIssueTypes(db: DB): string[] {
  return db.prepare("SELECT issue_type FROM scan_issues ORDER BY id").pluck().all() as string[];
}

it("binds a new file to the only strong matching logical identity", async () => {
  seedFileAndFingerprint(db, rootId, "existing.mp4", "v-existing", "key-a");
  const incoming = seedFile(db, rootId, "copy.mp4", "v-provisional");
  reconcileFileIdentity(db, {
    runId: "run-1",
    fileId: incoming,
    currentVideoId: "v-provisional",
    previousVideoId: "v-provisional",
    fingerprint: fingerprint("key-a", true),
    metadata: meta("video"),
    now: 200,
  });
  expect(videoIdOf(db, incoming)).toBe("v-existing");
  expect(statusOf(db, "v-provisional")).toBe("missing");
});

it("creates a new identity when content replaces an existing file", async () => {
  const fileId = seedFileAndFingerprint(db, rootId, "clip.mp4", "v-old", "key-old");
  insertVideo(db, { videoId: "v-provisional", kind: "video", status: "active", createdAt: 200, updatedAt: 200, lastSeenAt: 200, missingAt: null });
  bindFileVideo(db, fileId, "v-provisional");
  reconcileFileIdentity(db, {
    runId: "run-1",
    fileId,
    currentVideoId: "v-provisional",
    previousVideoId: "v-old",
    fingerprint: fingerprint("key-new", true),
    metadata: meta("video"),
    now: 200,
  });
  expect(videoIdOf(db, fileId)).not.toBe("v-old");
  expect(statusOf(db, "v-old")).toBe("missing");
});

it("records but does not resolve a multi-candidate conflict", async () => {
  const fileId = seedFile(db, rootId, "ambiguous.mp4", "v-provisional");
  seedFileAndFingerprint(db, rootId, "a.mp4", "v-a", "key-a");
  seedFileAndFingerprint(db, rootId, "b.mp4", "v-b", "key-a");
  const result = await reconcileFileIdentity(db, {
    runId: "run-1",
    fileId,
    currentVideoId: "v-provisional",
    previousVideoId: "v-provisional",
    fingerprint: fingerprint("key-a", true),
    metadata: meta("video"),
    now: 200,
  });
  expect(result.issueType).toBe("ambiguous_identity");
  expect(videoIdOf(db, fileId)).toBe("v-provisional");
  expect(openIssueTypes(db)).toEqual(["ambiguous_identity"]);
});
```

Also test that two physical files sharing one unique logical identity are both bound to that identity, and that a weak fingerprint records `probe_failed` without reusing a candidate.

- [ ] **Step 2: Run the service tests and verify the service is missing.**

Run:

```text
npm run test:core -- electron/core/__tests__/scanService.test.ts
```

Expected: FAIL because `scanService.ts` does not exist.

- [ ] **Step 3: Implement preparation and transaction-scoped reconciliation.**

Export these exact interfaces and functions:

```ts
export interface PreparedIdentity {
  fileId: number;
  metadata: ExtractedMeta;
  fingerprint: QuickFingerprint;
  probeFailed: boolean;
}

export interface ReconcileFileInput {
  runId: string;
  fileId: number;
  currentVideoId: string;
  previousVideoId: string | null;
  fingerprint: QuickFingerprint;
  metadata: ExtractedMeta;
  now: number;
  probeFailed?: boolean;
}

export interface ReconcileFileResult {
  decision: IdentityDecision["kind"];
  videoId: string;
  issueType?: string;
}

export async function prepareIdentity(
  file: { id: number; absPath: string; kind: Kind; size: number },
  metadata: ExtractedMeta,
  signal?: AbortSignal,
): Promise<PreparedIdentity>;

export function reconcileFileIdentity(
  db: DB,
  input: ReconcileFileInput,
): ReconcileFileResult;

export function recordMoveConflict(
  db: DB,
  runId: string,
  conflict: MoveConflict,
  now: number,
): void;
```

`prepareIdentity()` must call `quickFingerprint()` with the stat size captured by `syncFiles()`. It must not generate a different identity key for an ffprobe failure; it must set `probeFailed` and let the decision function prevent auto-binding. `reconcileFileIdentity()` must query candidates before upserting the current file’s fingerprint, call `decideIdentity()`, upsert the current fingerprint, then bind/reuse/create in one `db.transaction()` call. When a provisional or replaced identity loses its last live file, set it to `missing`; never delete it. Record conflicts with stable candidate ordering and include `fileId`, `relPath`, and the fingerprint key in `details_json`.

- [ ] **Step 4: Run the service and repository tests.**

Run:

```text
npm run test:core -- electron/core/__tests__/scanService.test.ts electron/core/__tests__/identityQueries.test.ts electron/core/__tests__/identity.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit identity reconciliation.**

```text
git add electron/core/scanService.ts electron/core/__tests__/scanService.test.ts electron/core/queries/identity.ts
git commit -m "feat: reconcile files with stable video identities"
```

## Task 7: Integrate scan-run persistence and identity work into the job pipeline

**Files:**
- Modify: `electron/core/jobs.ts:26-390`
- Create: `electron/core/__tests__/jobsIdentity.test.ts`

- [ ] **Step 1: Write failing end-to-end core scan tests for run status and identity persistence.**

Create `jobsIdentity.test.ts` with a temporary `Core` and deterministic media mocks. Put this mock block at the top of the test module so `jobs.ts` never invokes a real ffprobe/ffmpeg binary in these lifecycle tests:

```ts
vi.mock("../media.js", () => ({
  extractMeta: vi.fn(async () => ({
    width: 1920,
    height: 1080,
    duration: 10,
    codec: "h264",
    fps: 30,
    capturedAt: null,
    raw: { streams: [{ codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }] },
  })),
  coverArtStreamIndex: vi.fn(() => null),
  generateThumb: vi.fn(async (_src: string, _kind: Kind, dest: string) => {
    await fsp.writeFile(dest, "thumbnail");
    return true;
  }),
}));

let core: Core;
let db: DB;
let root: string;
let dataDir: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-jobs-"));
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-data-"));
  core = Core.init(root, { dataDir });
  db = core.db;
  await fsp.writeFile(path.join(root, "clip.mp4"), "media bytes");
});

afterEach(async () => {
  core.close();
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.rm(dataDir, { recursive: true, force: true });
});

it("persists a completed run, fingerprint, and video identity", async () => {
  const events: JobEvent[] = [];
  const stats = await runScan(core, "job-1", (event) => events.push(event));
  expect(stats.inserted).toBe(1);
  expect(db.prepare("SELECT status FROM scan_runs").get()).toEqual({ status: "completed" });
  expect(db.prepare("SELECT video_id FROM files WHERE deleted_at IS NULL").get()).toMatchObject({
    video_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
  });
  expect(db.prepare("SELECT count(*) AS n FROM fingerprints").get()).toEqual({ n: 1 });
  expect(events.at(-1)).toMatchObject({ type: "done", jobId: "job-1" });
});

it("marks an aborted run and does not soft-delete unseen files", async () => {
  const controller = new AbortController();
  controller.abort();
  await runScan(core, "job-aborted", () => {}, { signal: controller.signal });
  expect(db.prepare("SELECT status FROM scan_runs ORDER BY started_at DESC LIMIT 1").get())
    .toEqual({ status: "aborted" });
});
```

Import `Core`, `DB`, `Kind`, `JobEvent`, `runScan`, `fs/promises`, `os`, and `path` in this test file. Add a third test that temporarily makes `finishScanRun()` receive a database error through a `vi.spyOn` on the identity query module, then verifies `scan_runs.status = 'failed'` and a non-null `error_code` before the error is rethrown. Keep `electron/__tests__/scanManager.test.ts` focused on the unchanged renderer event contract.

- [ ] **Step 2: Run the job/scan tests and observe missing run integration.**

Run:

```text
npm run test:core -- electron/core/__tests__/jobsIdentity.test.ts
npm run test:core -- electron/__tests__/scanManager.test.ts
```

Expected: the new database assertions fail because `runScan()` does not yet create or finalize a `scan_runs` row.

- [ ] **Step 3: Add the run lifecycle around the existing scan phases.**

At the beginning of `runScan()`, generate a UUID run ID, call `createScanRun()`, and update `phase` before `rebuild`, `walk`, `hash`, `identity`, `index`, `thumb`, `tags`, and `complete`. Use a `try/catch/finally` structure that:

1. Marks `aborted` and emits the existing `{ type: "done", aborted: true }` event when `signal.aborted` is observed.
2. Marks `failed` with a stable error code and detail before rethrowing an exception.
3. Marks `completed` with the existing `ScanStats` plus identity/issue counters only after all non-aborted phases finish.
4. Calls `touchScanRoot()` only on the completed path.
5. Leaves the existing `JobEvent` union and renderer payload unchanged.

Do not catch and suppress database errors. Keep the existing `ScanManager` error handling responsible for the current `scan:done` error event.

- [ ] **Step 4: Reconcile identity work without a second ffprobe for pending thumbnails.**

Extend the local `ThumbResult` in `jobs.ts` with `preparedIdentity?: PreparedIdentity` and `identityError?: { code: string; detail: string }`. In `processOne`, pass the `ExtractedMeta` result to `prepareIdentity()` before returning. In `persistOne`, after `updateExtractedMeta()` and before `applyAutoMetaTags()`, call `reconcileFileIdentity()` inside the existing transaction. Record a `fingerprint_failed` issue for a rejected fingerprint and leave the provisional identity bound to the physical row.

After the thumbnail flush, query `files` with `video_id IS NOT NULL` and no `quick/v1` fingerprint. Process those legacy rows in a bounded pool using their stored metadata; if probe data is absent, call `extractMeta()` once and then `prepareIdentity()`. Commit each result through the same service function. This makes upgraded libraries converge without changing the renderer.

For every `moveConflict` returned by `syncFiles()`, call `recordMoveConflict()` under the current run ID before the completion decision. The FTS, thumbnail, auto-tag, orphan-prune, and all existing abort guards remain in their current order unless a test demonstrates that identity persistence requires a specific earlier phase.

- [ ] **Step 5: Run the full core scan/job regression set.**

Run:

```text
npm run test:core -- electron/core/__tests__/scan.test.ts electron/core/__tests__/scanService.test.ts electron/core/__tests__/jobsIdentity.test.ts electron/__tests__/scanManager.test.ts
```

Expected: PASS, including existing scan event, abort, thumbnail, and failure behavior.

- [ ] **Step 6: Commit the scan integration.**

```text
git add electron/core/jobs.ts electron/core/__tests__/jobsIdentity.test.ts
git commit -m "feat: persist scan runs and reconcile identities"
```

## Task 8: Verify rebuild, legacy upgrade, and Windows portable behavior

**Files:**
- Modify: `electron/core/__tests__/db.test.ts`
- Modify: `electron/core/__tests__/migrations.test.ts`
- Modify: `electron/core/__tests__/scanService.test.ts`
- Modify: `docs/portable-video-library-phase-0-audit.md`

- [ ] **Step 1: Add failing regression tests for table rebuild and rebuild scans.**

Add to the existing legacy `files` rebuild fixture a `video_id` column and an associated `videos` row, then assert `migrateKindCheck()` preserves the UUID and the `videos` row. Add a `runScan({ rebuild: true })` test that seeds a known fingerprint, rebuilds the physical index, and verifies the rescanned file can reuse the same logical `video_id` through its fingerprint rather than relying on the integer file ID.

- [ ] **Step 2: Run the targeted regression tests before the implementation adjustment.**

Run:

```text
npm run test:core -- electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts electron/core/__tests__/scanService.test.ts
```

Expected: the legacy/rebuild assertions fail until the fixture and scan path explicitly preserve the new model.

- [ ] **Step 3: Adjust rebuild handling and document the verified boundary.**

Keep `videos` and `scan_runs` during `clearIndex()`. Let the `fingerprints.file_id ON DELETE CASCADE` cleanup remove only fingerprints tied to deleted physical rows. Ensure the next scan creates provisional identities and `reconcileFileIdentity()` matches an exact unique `quick-v1` candidate before creating a second logical identity. Do not delete open issues; the run that created them remains auditable.

Update `docs/portable-video-library-phase-0-audit.md` so the phase 2 row records the implemented `video_id`, `quick-v1`, persisted scan state, and conflict queue, while leaving phase 3–5 items explicitly pending.

- [ ] **Step 4: Run targeted tests and commit compatibility changes.**

Run:

```text
npm run test:core -- electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts electron/core/__tests__/scanService.test.ts
```

Expected: PASS.

```text
git add electron/core/__tests__/db.test.ts electron/core/__tests__/migrations.test.ts electron/core/__tests__/scanService.test.ts docs/portable-video-library-phase-0-audit.md
git commit -m "test: verify phase2 identity recovery paths"
```

## Task 9: Run the complete quality gate and prepare the phase 2 handoff

**Files:**
- No new production files; review all changed files and `docs/superpowers/specs/2026-10-01-portable-video-library-phase2-identity-design.md`.

- [ ] **Step 1: Run formatting and static checks.**

Run:

```text
npm run format:check
npm run lint
npm run typecheck
```

Expected: all three commands exit with code 0 and report no changed files, lint errors, or TypeScript errors.

- [ ] **Step 2: Run the full automated test suite.**

Run:

```text
npm run test:core
npm run test:renderer
npm run test:e2e
```

Expected: all existing tests plus the new phase 2.1 tests pass. Record the exact counts in the final handoff; do not infer success from a partial command.

- [ ] **Step 3: Build and package the Windows portable artifact.**

Run:

```text
npm run build
npm run dist -- --win portable
```

Launch the resulting `release/win-unpacked` executable with a temporary `MEGURI_PORTABLE_ROOT` and temporary Electron user-data directory. Perform one scan, close, reopen, and perform a second scan. Verify `Data/library.sqlite` contains `schema_migrations` version `2`, `videos`, `fingerprints`, `scan_runs`, and `scan_issues`; verify the executable directory does not receive the user database.

- [ ] **Step 4: Review the final diff and commit the completed implementation.**

Run:

```text
git diff --check
git status --short
git log --oneline --decorate -12
```

Expected: no whitespace errors, no untracked generated artifacts, and all implementation commits on `feat/portable-video-library-v2` after the design commit `4e7375c`.

If the working tree is clean and all quality gates pass, create the final implementation commit only when the preceding task commits did not already cover the final documentation or test-only changes:

```text
git add electron docs
git commit -m "feat: complete phase2 identity indexing foundation"
```

- [ ] **Step 5: Report the handoff.**

Report the phase 2 branch, commit range, test/build/package results, portable artifact path and SHA-256, any intentionally skipped platform-specific test, and the remaining phase 3 scope. Do not claim completion until the verification commands above have produced successful output.

## Self-review checklist

- Spec §1–§2: Tasks 1, 5, 7, and 8 preserve the existing `files`/IPC model and add the stable identity boundary.
- Spec §3–§4: Task 1 creates `videos`, `fingerprints`, `scan_runs`, `scan_issues`, and the `files.video_id` bridge with checksummed migration.
- Spec §5: Task 2 implements the exact 4 MiB/8 MiB `quick-v1` rules and canonical key.
- Spec §6: Task 3 and Task 6 enforce unique strong reuse, no first-candidate selection, replacement separation, and issue persistence.
- Spec §7: Task 5 and Task 7 integrate physical synchronization, identity reconciliation, scan lifecycle, and existing derived tasks.
- Spec §8: Task 1 and Task 8 cover migration ordering, idempotency, `migrateKindCheck()`, read-only workers, and rebuild recovery.
- Spec §9: Task 9 covers core, renderer, E2E, typecheck, build, portable packaging, restart, and filesystem placement.
- Every task names its files, tests, commands, expected result, and concrete interface; function signatures and table names are consistent across tasks.
