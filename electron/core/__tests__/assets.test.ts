import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Core } from "../index.js";
import type { DB } from "../db.js";
import { newDb } from "./helpers.js";
import {
  ASSET_GENERATION_VERSIONS,
  assetRelativePath,
  choosePreferredAsset,
  isSafeAssetRelativePath,
  type AssetCandidate,
} from "../assets.js";
import * as assetService from "../assetService.js";
import {
  atomicWriteAsset,
  processPendingAssetTasks,
  queueDerivedAssets,
  readAssetFile,
} from "../assetService.js";
import { enqueueAssetTask } from "../queries/assets.js";

vi.mock("../media.js", () => ({
  generateThumb: vi.fn(
    async (_source: string, _kind: string, destination: string) => {
      await fsp.writeFile(destination, "generated");
      return true;
    },
  ),
  generateSheet: vi.fn(async (_source: string, destination: string) => {
    await fsp.writeFile(destination, "generated");
    return true;
  }),
}));

const dirs: string[] = [];
const databases: DB[] = [];
const cores: Core[] = [];

afterEach(() => {
  for (const core of cores.splice(0)) core.close();
  for (const db of databases.splice(0)) db.close();
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

function addVideo(db: DB, videoId: string, kind: "video" | "image" | "audio") {
  db.prepare(
    `INSERT INTO videos
      (video_id, kind, status, created_at, updated_at, last_seen_at)
     VALUES (?, ?, 'active', 0, 0, 0)`,
  ).run(videoId, kind);
}

describe("asset source policy", () => {
  const candidate = (
    source: AssetCandidate["source"],
    pathName: string,
  ): AssetCandidate => ({
    assetId: `${source}-id`,
    videoId: "5e9d0c19-5b43-4f4d-bc2e-53e7ac2f0f7e",
    kind: "cover",
    source,
    path: pathName,
    generationVersion: "cover-v1",
    status: "ready",
    updatedAt: 1,
  });

  it("prefers manual, then embedded, sidecar, and auto sources", () => {
    const chosen = choosePreferredAsset([
      candidate("auto", "auto.webp"),
      candidate("sidecar", "sidecar.webp"),
      candidate("embedded", "embedded.webp"),
      candidate("manual", "manual.webp"),
    ]);
    expect(chosen?.source).toBe("manual");
    expect(
      choosePreferredAsset([
        candidate("auto", "auto.webp"),
        candidate("sidecar", "sidecar.webp"),
      ])?.source,
    ).toBe("sidecar");
  });

  it("ignores non-ready and retired candidates", () => {
    const auto = candidate("auto", "auto.webp");
    expect(
      choosePreferredAsset([
        { ...auto, status: "failed" },
        { ...auto, assetId: "retired", status: "retired" },
      ]),
    ).toBeNull();
  });

  it("creates stable, path-safe relative names", () => {
    expect(
      assetRelativePath(
        "5e9d0c19-5b43-4f4d-bc2e-53e7ac2f0f7e",
        "cover",
        "webp",
      ),
    ).toBe("5e9d0c19-5b43-4f4d-bc2e-53e7ac2f0f7e/cover.webp");
    expect(ASSET_GENERATION_VERSIONS.sheet).toBe("sheet-v1");
    expect(isSafeAssetRelativePath("a/cover.webp")).toBe(true);
    expect(isSafeAssetRelativePath("../outside.webp")).toBe(false);
    expect(isSafeAssetRelativePath("C:/outside.webp")).toBe(false);
  });
});

describe("atomic asset storage", () => {
  it("exposes an FFmpeg temporary path with the destination extension", () => {
    const temporary = assetService.assetTemporaryPath(
      path.join("assets", "cover.webp"),
    );
    expect(path.extname(temporary)).toBe(".webp");
  });

  it("queues automatic cover and sheet tasks only for videos", () => {
    const { db } = newDb();
    databases.push(db);
    addVideo(db, "video-id", "video");
    addVideo(db, "image-id", "image");
    addVideo(db, "audio-id", "audio");

    queueDerivedAssets(db, { videoId: "video-id", kind: "video", now: 1 });
    queueDerivedAssets(db, { videoId: "image-id", kind: "image", now: 1 });
    queueDerivedAssets(db, { videoId: "audio-id", kind: "audio", now: 1 });

    expect(
      db
        .prepare(
          "SELECT video_id AS videoId, kind, source FROM asset_tasks ORDER BY kind",
        )
        .all(),
    ).toEqual([
      { videoId: "video-id", kind: "cover", source: "auto" },
      { videoId: "video-id", kind: "sheet", source: "auto" },
    ]);
  });

  it("completes an old non-video asset task without generating a file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-asset-root-"));
    const dataRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-asset-data-"),
    );
    dirs.push(root, dataRoot);
    const core = Core.init(root, { dataDir: dataRoot });
    cores.push(core);
    const source = path.join(root, "picture.jpg");
    await fsp.writeFile(source, "image bytes");
    const videoId = "image-video-id";
    addVideo(core.db, videoId, "image");
    core.db
      .prepare(
        `INSERT INTO files
          (root_id, rel_path, abs_path, kind, ext, size, video_id, thumb_status, created_at)
         VALUES (?, 'picture.jpg', ?, 'image', 'jpg', 11, ?, 'done', 0)`,
      )
      .run(core.rootId, source, videoId);
    enqueueAssetTask(core.db, {
      videoId,
      kind: "cover",
      source: "auto",
      now: 1,
    });

    const media = await import("../media.js");
    vi.mocked(media.generateThumb).mockClear();
    const result = await processPendingAssetTasks(core, { now: 1 });

    expect(result).toEqual({ completed: 1, failed: 0 });
    expect(vi.mocked(media.generateThumb)).not.toHaveBeenCalled();
    expect(core.db.prepare("SELECT status FROM asset_tasks").get()).toEqual({
      status: "completed",
    });
  });

  it("writes and reads a completed asset without exposing a partial file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-assets-"));
    dirs.push(root);
    const relative = "video-id/cover.webp";
    await atomicWriteAsset(root, relative, Buffer.from("webp"));
    await expect(readAssetFile(root, relative)).resolves.toEqual(
      Buffer.from("webp"),
    );
    expect(fs.readdirSync(path.join(root, "video-id"))).toEqual(["cover.webp"]);
  });
});
