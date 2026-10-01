import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedMeta } from "../media.js";
import { insertFile, newDb } from "./helpers.js";
import type { DB } from "../db.js";
import {
  bindFileVideo,
  createScanRun,
  insertVideo,
  upsertFingerprint,
  type FingerprintRow,
} from "../queries/identity.js";
import type { QuickFingerprint } from "../fingerprint.js";
import {
  reconcileFileIdentity,
  type ReconcileFileInput,
} from "../scanService.js";

const openDbs: DB[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

function meta(kind: "video" | "image" | "audio" = "video"): ExtractedMeta {
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
    firstHash: "a".repeat(64),
    lastHash: "b".repeat(64),
    fullHash: null,
    durationMs: 10_000,
    streamSignature: strong
      ? '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}'
      : '{"kind":"video","codec":null,"width":null,"height":null,"fpsMilli":null}',
    fingerprintKey: key,
  };
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
    durationMs: 10_000,
    firstHash: "a".repeat(64),
    lastHash: "b".repeat(64),
    fullHash: null,
    streamSignature:
      '{"kind":"video","codec":"h264","width":1920,"height":1080,"fpsMilli":30000}',
    computedAt: now,
  };
}

function seedFile(
  db: DB,
  rootId: number,
  relPath: string,
  videoId: string,
): number {
  const fileId = insertFile(db, rootId, {
    relPath,
    kind: "video",
    size: 10,
    mtime: 100,
  });
  insertVideo(db, {
    videoId,
    kind: "video",
    status: "active",
    createdAt: 100,
    updatedAt: 100,
    lastSeenAt: 100,
    missingAt: null,
  });
  bindFileVideo(db, fileId, videoId);
  return fileId;
}

function runInput(
  fileId: number,
  currentVideoId: string,
  previousVideoId: string | null,
  value: QuickFingerprint,
  probeFailed = false,
): ReconcileFileInput {
  return {
    runId: "run-1",
    fileId,
    currentVideoId,
    previousVideoId,
    fingerprint: value,
    metadata: meta(),
    now: 200,
    probeFailed,
  };
}

function videoIdOf(db: DB, fileId: number): string {
  return (
    db.prepare("SELECT video_id FROM files WHERE id = ?").get(fileId) as {
      video_id: string;
    }
  ).video_id;
}

function statusOf(db: DB, videoId: string): string {
  return (
    db.prepare("SELECT status FROM videos WHERE video_id = ?").get(videoId) as {
      status: string;
    }
  ).status;
}

describe("scan identity service", () => {
  it("binds a new file to the only strong matching logical identity", () => {
    const { db, rootId } = newDb();
    openDbs.push(db);
    createScanRun(db, rootId, "run-1", 100);
    const existing = seedFile(db, rootId, "existing.mp4", "v-existing");
    upsertFingerprint(db, fingerprintRow(existing, "key-a", 100));
    const incoming = seedFile(db, rootId, "copy.mp4", "v-provisional");

    const result = reconcileFileIdentity(
      db,
      runInput(incoming, "v-provisional", null, fingerprint("key-a", true)),
    );

    expect(result).toMatchObject({ decision: "reuse", videoId: "v-existing" });
    expect(videoIdOf(db, incoming)).toBe("v-existing");
    expect(statusOf(db, "v-provisional")).toBe("missing");
  });

  it("creates a new identity when content replaces an existing file", () => {
    const { db, rootId } = newDb();
    openDbs.push(db);
    createScanRun(db, rootId, "run-1", 100);
    const fileId = seedFile(db, rootId, "clip.mp4", "v-provisional");
    insertVideo(db, {
      videoId: "v-old",
      kind: "video",
      status: "active",
      createdAt: 100,
      updatedAt: 100,
      lastSeenAt: 100,
      missingAt: null,
    });
    upsertFingerprint(db, fingerprintRow(fileId, "key-old", 100));

    const result = reconcileFileIdentity(
      db,
      runInput(
        fileId,
        "v-provisional",
        "v-old",
        fingerprint("key-new", true),
      ),
    );

    expect(result.decision).toBe("create");
    expect(videoIdOf(db, fileId)).toBe("v-provisional");
    expect(statusOf(db, "v-old")).toBe("missing");
  });

  it("records but does not resolve a multi-candidate conflict", () => {
    const { db, rootId } = newDb();
    openDbs.push(db);
    createScanRun(db, rootId, "run-1", 100);
    const first = seedFile(db, rootId, "a.mp4", "v-a");
    const second = seedFile(db, rootId, "b.mp4", "v-b");
    upsertFingerprint(db, fingerprintRow(first, "key-a", 100));
    upsertFingerprint(db, fingerprintRow(second, "key-a", 100));
    const incoming = seedFile(db, rootId, "ambiguous.mp4", "v-provisional");

    const result = reconcileFileIdentity(
      db,
      runInput(incoming, "v-provisional", null, fingerprint("key-a", true)),
    );

    expect(result.issueType).toBe("ambiguous_identity");
    expect(videoIdOf(db, incoming)).toBe("v-provisional");
    expect(
      db.prepare("SELECT issue_type FROM scan_issues ORDER BY id").pluck().all(),
    ).toEqual(["ambiguous_identity"]);
  });

  it("does not reuse a candidate when probe evidence is weak", () => {
    const { db, rootId } = newDb();
    openDbs.push(db);
    createScanRun(db, rootId, "run-1", 100);
    const existing = seedFile(db, rootId, "existing.mp4", "v-existing");
    upsertFingerprint(db, fingerprintRow(existing, "key-a", 100));
    const incoming = seedFile(db, rootId, "weak.mp4", "v-provisional");

    const result = reconcileFileIdentity(
      db,
      runInput(
        incoming,
        "v-provisional",
        null,
        fingerprint("key-a", false),
        true,
      ),
    );

    expect(result.issueType).toBe("probe_failed");
    expect(videoIdOf(db, incoming)).toBe("v-provisional");
  });
});
