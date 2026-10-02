import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Core } from "../index.js";
import type { DB } from "../db.js";
import { runScan, type JobEvent } from "../jobs.js";
import type { Kind } from "../types.js";

vi.mock("../media.js", () => ({
  extractMeta: vi.fn(() => ({
    width: 1920,
    height: 1080,
    duration: 10,
    codec: "h264",
    fps: 30,
    capturedAt: null,
    raw: {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1920,
          height: 1080,
        },
      ],
    },
  })),
  coverArtStreamIndex: vi.fn(() => null),
  generateThumb: vi.fn(
    async (
      _src: string,
      _kind: Kind,
      dest: string,
      _signal?: AbortSignal,
      _offset?: number,
      _cover?: number,
      _onError?: (message: string) => void,
    ) => {
      void _src;
      void _kind;
      void _signal;
      void _offset;
      void _cover;
      void _onError;
      await fsp.writeFile(dest, "thumbnail");
      return true;
    },
  ),
}));

describe("runScan identity integration", () => {
  let core: Core;
  let db: DB;
  let root: string;
  let dataDir: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-jobs-"));
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-data-"));
    core = (await import("../index.js")).Core.init(root, { dataDir });
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
    const file = db
      .prepare("SELECT video_id FROM files WHERE deleted_at IS NULL")
      .get() as { video_id: string };

    expect(stats.inserted).toBe(1);
    expect(db.prepare("SELECT status FROM scan_runs").get()).toEqual({
      status: "completed",
    });
    expect(file.video_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(db.prepare("SELECT count(*) AS n FROM fingerprints").get()).toEqual({
      n: 1,
    });
    expect(events.at(-1)).toMatchObject({ type: "done", jobId: "job-1" });
  });

  it("completes the scan without draining derived-asset work", async () => {
    const events: JobEvent[] = [];

    await runScan(core, "job-assets", (event) => events.push(event));

    expect(events.at(-1)).toMatchObject({
      type: "done",
      jobId: "job-assets",
    });
    expect(db.prepare("SELECT status FROM scan_runs").get()).toEqual({
      status: "completed",
    });
    expect(
      db
        .prepare(
          "SELECT status, COUNT(*) AS count FROM asset_tasks GROUP BY status",
        )
        .all(),
    ).toEqual([{ status: "queued", count: 2 }]);
  });

  it("indexes images without generating a thumbnail", async () => {
    const media = await import("../media.js");
    const imagePath = path.join(root, "picture.jpg");
    await fsp.writeFile(imagePath, "image bytes");
    vi.mocked(media.generateThumb).mockClear();

    await runScan(core, "job-image", () => {});

    const row = db
      .prepare(
        "SELECT kind, thumb_status AS thumbStatus, thumb_path AS thumbPath FROM files WHERE rel_path = ?",
      )
      .get("picture.jpg") as {
      kind: string;
      thumbStatus: string;
      thumbPath: string | null;
    };
    expect(row).toEqual({
      kind: "image",
      thumbStatus: "done",
      thumbPath: null,
    });
    expect(
      vi
        .mocked(media.generateThumb)
        .mock.calls.some(([source]) => source === imagePath),
    ).toBe(false);
    expect(
      vi
        .mocked(media.generateThumb)
        .mock.calls.some(([source]) => source === path.join(root, "clip.mp4")),
    ).toBe(true);
  });

  it("marks an aborted run and does not soft-delete unseen files", async () => {
    const controller = new AbortController();
    controller.abort();

    await runScan(core, "job-aborted", () => {}, {
      signal: controller.signal,
    });

    expect(
      db
        .prepare(
          "SELECT status FROM scan_runs ORDER BY started_at DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ status: "aborted" });
  });

  it("records a failed run before rethrowing a scan error", async () => {
    const media = await import("../media.js");
    vi.mocked(media.generateThumb).mockImplementationOnce(
      (_src, _kind, _dest, _signal, _offset, _cover, onError) => {
        onError?.("ffmpeg test failure");
        return Promise.resolve(false);
      },
    );

    await expect(runScan(core, "job-failed", () => {})).rejects.toThrow(
      "thumbnail extraction failed for all",
    );

    expect(
      db
        .prepare(
          "SELECT status, error_code AS errorCode FROM scan_runs ORDER BY started_at DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ status: "failed", errorCode: "scan_failed" });
    expect(
      db
        .prepare(
          "SELECT issue_type AS issueType, details_json AS detailsJson FROM scan_issues ORDER BY id DESC LIMIT 1",
        )
        .get(),
    ).toEqual({
      issueType: "thumbnail_failed",
      detailsJson: JSON.stringify({
        phase: "thumbnail",
        message: "ffmpeg test failure",
      }),
    });
  });

  it("reuses the logical identity after a physical index rebuild", async () => {
    await runScan(core, "job-before-rebuild", () => {});
    const before = db
      .prepare("SELECT video_id AS videoId FROM files WHERE deleted_at IS NULL")
      .get() as { videoId: string };

    await runScan(core, "job-rebuild", () => {}, { rebuild: true });

    const after = db
      .prepare("SELECT video_id AS videoId FROM files WHERE deleted_at IS NULL")
      .get() as { videoId: string };
    expect(after.videoId).toBe(before.videoId);
  });
});
