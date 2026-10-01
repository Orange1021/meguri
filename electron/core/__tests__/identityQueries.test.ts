import { describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { insertFile, newDb } from "./helpers.js";
import {
  bindFileVideo,
  createScanRun,
  finishScanRun,
  findFingerprintCandidates,
  insertVideo,
  recordScanIssue,
  upsertFingerprint,
  type FingerprintRow,
} from "../queries/identity.js";

function createVideoForFile(
  db: DB,
  fileId: number,
  kind: "video" | "image" | "audio",
  videoId: string,
  now: number,
): void {
  insertVideo(db, {
    videoId,
    kind,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    missingAt: null,
  });
  bindFileVideo(db, fileId, videoId);
}

function fingerprintRow(
  fileId: number,
  key: string,
  now: number,
): FingerprintRow {
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
    streamSignature:
      '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}',
    computedAt: now,
  };
}

describe("identity queries", () => {
  it("creates and finalizes a scan run with JSON stats", () => {
    const { db, rootId } = newDb();
    const runId = "run-1";
    createScanRun(db, rootId, runId, 100);
    finishScanRun(db, runId, "completed", { inserted: 1, issues: 0 }, 120);

    expect(db.prepare("SELECT * FROM scan_runs WHERE run_id = ?").get(runId)).toMatchObject({
      run_id: "run-1",
      status: "completed",
      started_at: 100,
      finished_at: 120,
      stats_json: JSON.stringify({ inserted: 1, issues: 0 }),
    });
    db.close();
  });

  it("records an issue with the caller's candidate order", () => {
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

    expect(
      db
        .prepare(
          "SELECT candidate_video_ids_json, details_json FROM scan_issues WHERE id = ?",
        )
        .get(id),
    ).toEqual({
      candidate_video_ids_json: '["v-b","v-a"]',
      details_json: '{"relPath":"clip.mp4"}',
    });
    db.close();
  });

  it("upserts one current fingerprint per file and finds candidates excluding the file", () => {
    const { db, rootId } = newDb();
    const first = insertFile(db, rootId, {
      relPath: "a.mp4",
      contentHash: "legacy-a",
    });
    const second = insertFile(db, rootId, {
      relPath: "b.mp4",
      contentHash: "legacy-b",
    });
    createVideoForFile(db, first, "video", "v-a", 100);
    createVideoForFile(db, second, "video", "v-b", 100);
    upsertFingerprint(db, fingerprintRow(first, "key", 100));
    upsertFingerprint(db, fingerprintRow(second, "key", 100));

    expect(findFingerprintCandidates(db, "key", first)).toEqual([
      { videoId: "v-b", strong: true },
    ]);
    db.close();
  });

  it("rejects overwriting a terminal scan run", () => {
    const { db, rootId } = newDb();
    createScanRun(db, rootId, "run-1", 100);
    finishScanRun(db, "run-1", "aborted", {}, 101);
    expect(() => finishScanRun(db, "run-1", "completed", {}, 102)).toThrow(
      "scan run is already terminal",
    );
    db.close();
  });
});
