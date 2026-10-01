import type { DB } from "./db.js";
import {
  FINGERPRINT_ALGORITHM,
  FINGERPRINT_VERSION,
  quickFingerprint,
  type FingerprintMetadata,
  type QuickFingerprint,
} from "./fingerprint.js";
import { decideIdentity, type IdentityDecision } from "./identity.js";
import {
  bindFileVideo,
  findFingerprintCandidates,
  fingerprintForFile,
  insertVideo,
  recordScanIssue,
  updateVideoStatus,
  upsertFingerprint,
} from "./queries/identity.js";
import type { MoveConflict } from "./scan.js";
import type { ExtractedMeta } from "./media.js";
import type { Kind } from "./types.js";

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
): Promise<PreparedIdentity> {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const fingerprintMetadata: FingerprintMetadata = {
    kind: file.kind,
    duration: metadata.duration,
    codec: metadata.codec,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
  };
  const fingerprint = await quickFingerprint(
    file.absPath,
    fingerprintMetadata,
    file.size,
  );
  return {
    fileId: file.id,
    metadata,
    fingerprint,
    probeFailed: metadata.raw == null,
  };
}

export function reconcileFileIdentity(
  db: DB,
  input: ReconcileFileInput,
): ReconcileFileResult {
  const previous = fingerprintForFile(db, input.fileId);
  const candidates = findFingerprintCandidates(
    db,
    input.fingerprint.fingerprintKey,
    input.fileId,
  );
  const decision = decideIdentity({
    currentVideoId: input.currentVideoId,
    previousKey: previous?.fingerprintKey ?? null,
    currentKey: input.fingerprint.fingerprintKey,
    candidates,
    strong:
      !input.probeFailed && hasStrongFingerprintEvidence(input.fingerprint),
  });
  const filePath = (
    db.prepare("SELECT rel_path AS relPath FROM files WHERE id = ?").get(input.fileId) as
      | { relPath: string }
      | undefined
  )?.relPath;

  let result!: ReconcileFileResult;
  db.transaction(() => {
    ensureVideo(db, input.currentVideoId, input.metadata, input.now);
    upsertFingerprint(db, {
      fileId: input.fileId,
      algorithm: input.fingerprint.algorithm,
      version: input.fingerprint.version,
      fingerprintKey: input.fingerprint.fingerprintKey,
      size: input.fingerprint.size,
      durationMs: input.fingerprint.durationMs,
      firstHash: input.fingerprint.firstHash,
      lastHash: input.fingerprint.lastHash,
      fullHash: input.fingerprint.fullHash,
      streamSignature: input.fingerprint.streamSignature,
      computedAt: input.now,
    });

    const finalVideoId =
      decision.kind === "reuse" || decision.kind === "keep"
        ? decision.videoId
        : input.currentVideoId;
    if (finalVideoId !== input.currentVideoId) {
      bindFileVideo(db, input.fileId, finalVideoId);
      markMissingWhenUnreferenced(db, input.currentVideoId, input.now);
    }
    updateVideoStatus(db, finalVideoId, "active", input.now);

    if (
      input.previousVideoId &&
      input.previousVideoId !== finalVideoId
    ) {
      markMissingWhenUnreferenced(db, input.previousVideoId, input.now);
    }

    if (decision.kind === "conflict") {
      recordScanIssue(db, {
        runId: input.runId,
        fileId: input.fileId,
        issueType: decision.issueType,
        severity: decision.issueType === "probe_failed" ? "error" : "warning",
        candidateVideoIds: decision.candidateVideoIds,
        details: {
          relPath: filePath ?? null,
          fingerprintKey: input.fingerprint.fingerprintKey,
        },
        now: input.now,
      });
      result = {
        decision: decision.kind,
        videoId: finalVideoId,
        issueType: decision.issueType,
      };
    } else {
      result = { decision: decision.kind, videoId: finalVideoId };
    }
  })();
  return result;
}

export function recordMoveConflict(
  db: DB,
  runId: string,
  conflict: MoveConflict,
  now: number,
): void {
  const candidateVideoIds = db
    .prepare(
      "SELECT video_id AS videoId FROM files " +
        "WHERE id IN (SELECT value FROM json_each(?)) AND video_id IS NOT NULL " +
        "ORDER BY video_id",
    )
    .pluck()
    .all(JSON.stringify(conflict.candidateIds)) as string[];
  recordScanIssue(db, {
    runId,
    fileId: null,
    issueType: "duplicate_candidate",
    severity: "warning",
    candidateVideoIds,
    details: {
      relPath: conflict.relPath,
      size: conflict.size,
      legacyHash: conflict.legacyHash,
      candidateIds: conflict.candidateIds,
      candidatePaths: conflict.candidatePaths,
    },
    now,
  });
}

function ensureVideo(
  db: DB,
  videoId: string,
  metadata: ExtractedMeta,
  now: number,
): void {
  const exists = db
    .prepare("SELECT 1 FROM videos WHERE video_id = ?")
    .get(videoId);
  if (exists) return;
  insertVideo(db, {
    videoId,
    kind: metadataKind(metadata),
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    missingAt: null,
  });
}

function metadataKind(metadata: ExtractedMeta): Kind {
  if (metadata.width != null || metadata.height != null) return "video";
  return "audio";
}

function markMissingWhenUnreferenced(
  db: DB,
  videoId: string,
  now: number,
): void {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM files WHERE video_id = ? AND deleted_at IS NULL",
    )
    .get(videoId) as { count: number };
  if (row.count === 0) updateVideoStatus(db, videoId, "missing", now);
}

function hasStrongFingerprintEvidence(fingerprint: QuickFingerprint): boolean {
  if (fingerprint.fullHash != null) return true;
  try {
    const signature = JSON.parse(fingerprint.streamSignature) as {
      codec?: unknown;
    };
    return typeof signature.codec === "string" && signature.codec.length > 0;
  } catch {
    return false;
  }
}

export const QUICK_FINGERPRINT_IDENTITY = {
  algorithm: FINGERPRINT_ALGORITHM,
  version: FINGERPRINT_VERSION,
} as const;
