import type { DB } from "../db.js";
import type { IdentityCandidate } from "../identity.js";
import type { Kind } from "../types.js";

export type VideoStatus = "active" | "missing";
export type ScanRunStatus = "completed" | "aborted" | "failed";
export type ScanIssueSeverity = "warning" | "error";

export interface VideoRow {
  videoId: string;
  kind: Kind;
  status: VideoStatus;
  createdAt: number;
  updatedAt: number;
  lastSeenAt: number | null;
  missingAt: number | null;
}

export interface FingerprintRow {
  fileId: number;
  algorithm: string;
  version: string;
  fingerprintKey: string;
  size: number;
  durationMs: number | null;
  firstHash: string | null;
  lastHash: string | null;
  fullHash: string | null;
  streamSignature: string;
  computedAt: number;
}

export interface ScanIssueInput {
  runId: string;
  fileId: number | null;
  issueType: string;
  severity: ScanIssueSeverity;
  candidateVideoIds?: readonly string[] | null;
  details?: unknown;
  now: number;
}

export function createScanRun(
  db: DB,
  rootId: number,
  runId: string,
  now: number,
): void {
  db.prepare(
    "INSERT INTO scan_runs " +
      "(run_id, root_id, status, started_at) VALUES (?, ?, 'running', ?)",
  ).run(runId, rootId, now);
}

export function updateScanRunPhase(db: DB, runId: string, phase: string): void {
  const result = db
    .prepare(
      "UPDATE scan_runs SET phase = ? WHERE run_id = ? AND status = 'running'",
    )
    .run(phase, runId);
  if (result.changes !== 1) throw new Error("scan run is not running");
}

export function finishScanRun(
  db: DB,
  runId: string,
  status: ScanRunStatus,
  stats: unknown,
  finishedAt: number,
  error?: { code: string; detail: string },
): void {
  const current = db
    .prepare("SELECT status FROM scan_runs WHERE run_id = ?")
    .get(runId) as { status: string } | undefined;
  if (!current) throw new Error("scan run not found");
  if (current.status !== "running") {
    throw new Error("scan run is already terminal");
  }
  db.prepare(
    "UPDATE scan_runs SET status = ?, finished_at = ?, stats_json = ?, " +
      "error_code = ?, error_detail = ? WHERE run_id = ? AND status = 'running'",
  ).run(
    status,
    finishedAt,
    JSON.stringify(stats),
    error?.code ?? null,
    error?.detail ?? null,
    runId,
  );
}

export function recordScanIssue(db: DB, input: ScanIssueInput): number {
  const result = db
    .prepare(
      "INSERT INTO scan_issues " +
        "(run_id, file_id, issue_type, severity, candidate_video_ids_json, details_json, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.runId,
      input.fileId,
      input.issueType,
      input.severity,
      input.candidateVideoIds == null
        ? null
        : JSON.stringify(input.candidateVideoIds),
      input.details === undefined ? null : JSON.stringify(input.details),
      input.now,
    );
  return Number(result.lastInsertRowid);
}

export function insertVideo(db: DB, video: VideoRow): void {
  db.prepare(
    "INSERT INTO videos " +
      "(video_id, kind, status, created_at, updated_at, last_seen_at, missing_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(
    video.videoId,
    video.kind,
    video.status,
    video.createdAt,
    video.updatedAt,
    video.lastSeenAt,
    video.missingAt,
  );
}

export function updateVideoStatus(
  db: DB,
  videoId: string,
  status: VideoStatus,
  now: number,
): void {
  const result = db
    .prepare(
      "UPDATE videos SET status = ?, updated_at = ?, last_seen_at = ?, missing_at = ? " +
        "WHERE video_id = ?",
    )
    .run(
      status,
      now,
      status === "active" ? now : null,
      status === "missing" ? now : null,
      videoId,
    );
  if (result.changes !== 1) throw new Error("video not found");
}

export function bindFileVideo(db: DB, fileId: number, videoId: string): void {
  const result = db
    .prepare("UPDATE files SET video_id = ? WHERE id = ?")
    .run(videoId, fileId);
  if (result.changes !== 1) throw new Error("file not found");
}

export function upsertFingerprint(db: DB, row: FingerprintRow): void {
  db.prepare(
    "INSERT INTO fingerprints " +
      "(file_id, algorithm, version, fingerprint_key, size, duration_ms, first_hash, last_hash, full_hash, stream_signature, computed_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(file_id, algorithm, version) DO UPDATE SET " +
      "fingerprint_key = excluded.fingerprint_key, size = excluded.size, " +
      "duration_ms = excluded.duration_ms, first_hash = excluded.first_hash, " +
      "last_hash = excluded.last_hash, full_hash = excluded.full_hash, " +
      "stream_signature = excluded.stream_signature, computed_at = excluded.computed_at",
  ).run(
    row.fileId,
    row.algorithm,
    row.version,
    row.fingerprintKey,
    row.size,
    row.durationMs,
    row.firstHash,
    row.lastHash,
    row.fullHash,
    row.streamSignature,
    row.computedAt,
  );
}

export function findFingerprintCandidates(
  db: DB,
  key: string,
  excludeFileId: number,
): IdentityCandidate[] {
  const rows = db
    .prepare(
      "SELECT f.video_id AS videoId, fp.full_hash AS fullHash, fp.stream_signature AS streamSignature " +
        "FROM fingerprints fp JOIN files f ON f.id = fp.file_id " +
        "WHERE fp.algorithm = 'quick' AND fp.version = 'v1' " +
        "AND fp.fingerprint_key = ? AND fp.file_id <> ? AND f.video_id IS NOT NULL " +
        "ORDER BY f.video_id",
    )
    .all(key, excludeFileId) as Array<{
    videoId: string;
    fullHash: string | null;
    streamSignature: string;
  }>;
  return rows.map((row) => ({
    videoId: row.videoId,
    strong:
      row.fullHash != null || streamSignatureHasCodec(row.streamSignature),
  }));
}

export function fingerprintForFile(
  db: DB,
  fileId: number,
): FingerprintRow | null {
  const row = db
    .prepare(
      "SELECT file_id AS fileId, algorithm, version, fingerprint_key AS fingerprintKey, " +
        "size, duration_ms AS durationMs, first_hash AS firstHash, last_hash AS lastHash, " +
        "full_hash AS fullHash, stream_signature AS streamSignature, computed_at AS computedAt " +
        "FROM fingerprints WHERE file_id = ? AND algorithm = 'quick' AND version = 'v1'",
    )
    .get(fileId) as FingerprintRow | undefined;
  return row ?? null;
}

function streamSignatureHasCodec(signature: string): boolean {
  try {
    const parsed = JSON.parse(signature) as { codec?: unknown };
    return typeof parsed.codec === "string" && parsed.codec.length > 0;
  } catch {
    return false;
  }
}
