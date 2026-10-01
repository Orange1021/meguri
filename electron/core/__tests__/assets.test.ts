import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ASSET_GENERATION_VERSIONS,
  assetRelativePath,
  choosePreferredAsset,
  isSafeAssetRelativePath,
  type AssetCandidate,
} from "../assets.js";
import { atomicWriteAsset, readAssetFile } from "../assetService.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("asset source policy", () => {
  const candidate = (source: AssetCandidate["source"], pathName: string): AssetCandidate => ({
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
    expect(assetRelativePath("5e9d0c19-5b43-4f4d-bc2e-53e7ac2f0f7e", "cover", "webp")).toBe(
      "5e9d0c19-5b43-4f4d-bc2e-53e7ac2f0f7e/cover.webp",
    );
    expect(ASSET_GENERATION_VERSIONS.sheet).toBe("sheet-v1");
    expect(isSafeAssetRelativePath("a/cover.webp")).toBe(true);
    expect(isSafeAssetRelativePath("../outside.webp")).toBe(false);
    expect(isSafeAssetRelativePath("C:/outside.webp")).toBe(false);
  });
});

describe("atomic asset storage", () => {
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
