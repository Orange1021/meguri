# Background Asset Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a rescan finish after the file index is synchronized while cover and contact-sheet generation continues as recoverable background work.

**Architecture:** Keep filesystem enumeration, database synchronization, metadata, and search indexing inside `runScan`. Move derived cover/sheet draining into a per-workspace background worker owned by `ScanManager`, so asset failures cannot keep a scan run in `running`. Reset abandoned asset tasks before claiming new work; the existing scan thumbnail pipeline remains responsible for list-thumbnail refresh events.

**Tech Stack:** Electron main process, TypeScript, better-sqlite3, Vitest, React IPC events.

---

### Task 1: Lock down asset-task recovery

**Files:**

- Modify: `electron/core/queries/assets.ts`
- Test: `electron/core/__tests__/assets.test.ts`

- [x] Add a failing test proving stale `running` tasks can be returned to `queued` with their retry timestamp reset.
- [x] Run the focused asset test and confirm it fails because the recovery operation does not exist.
- [x] Add the smallest transactional recovery query and test the affected row count.
- [x] Run the focused asset test and confirm it passes.

### Task 2: Decouple scan completion from asset generation

**Files:**

- Modify: `electron/core/jobs.ts`
- Test: `electron/core/__tests__/jobsIdentity.test.ts`

- [x] Add a failing test where a queued asset task never needs to be processed for `runScan` to emit `done` and persist a completed scan run.
- [x] Run the focused jobs test and confirm the current implementation fails because it drains asset work before completion.
- [x] Remove the unbounded asset-drain loop from `runScan`; leave queue creation intact and let the caller own background draining.
- [x] Run the focused jobs test and confirm the scan completes with queued assets remaining.

### Task 3: Add a recoverable per-workspace background worker

**Files:**

- Modify: `electron/scanManager.ts`
- Modify: `electron/core/assetService.ts`
- Test: `electron/__tests__/scanManager.test.ts`

- [x] Add tests proving a completed scan starts bounded background asset work, a second worker is not started for the same workspace, and an aborted worker does not strand tasks as `running`.
- [x] Run the focused manager tests and confirm they fail against the current synchronous scan behavior.
- [x] Implement one worker loop per workspace with bounded batches, cancellation, stale-task recovery, and failed-batch continuation.
- [x] Run the focused manager and asset tests and confirm they pass.

### Task 4: Verify user-visible behavior and package the portable build

**Files:**

- Modify: `src/components/ScanProgress.tsx` only if the event lifecycle requires a UI adjustment.
- Modify: `src/components/StatusBar.tsx` only if the event lifecycle requires a UI adjustment.

- [x] Run formatting, typecheck, the complete test suite, and the portable build.
- [x] Start the generated portable executable long enough to confirm it remains alive and does not immediately crash.
- [x] Review the diff for accidental changes to `Data` or `Media`, then commit and push only source/test/docs changes to `origin/main`.
