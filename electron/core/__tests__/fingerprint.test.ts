import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildFingerprintKey,
  quickFingerprint,
  type FingerprintMetadata,
} from "../fingerprint.js";

function meta(kind: FingerprintMetadata["kind"]): FingerprintMetadata {
  return {
    kind,
    duration: kind === "video" ? 10 : null,
    codec: kind === "video" ? "h264" : null,
    width: kind === "video" ? 1920 : null,
    height: kind === "video" ? 1080 : null,
    fps: kind === "video" ? 30 : null,
  };
}

describe("quick-v1 fingerprint", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-fingerprint-"));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

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
    const changed = Buffer.from(data);
    changed[changed.length - 1] = 0x43;
    await fsp.writeFile(file, changed);
    const next = await quickFingerprint(file, meta("video"));
    expect(next.firstHash).toBe(result.firstHash);
    expect(next.lastHash).not.toBe(result.lastHash);
    expect(next.fingerprintKey).not.toBe(result.fingerprintKey);
  });

  it("rejects a file whose size changed during the fingerprint request", async () => {
    const file = path.join(dir, "drift.mp4");
    await fsp.writeFile(file, "bytes");

    await expect(
      quickFingerprint(file, meta("video"), 999),
    ).rejects.toMatchObject({ code: "file-changed-during-read" });
  });

  it("normalizes duration and stream metadata into a stable key", () => {
    const a = buildFingerprintKey({
      ...meta("video"),
      duration: 1.2344,
      fps: 29.97,
    });
    const b = buildFingerprintKey({
      ...meta("video"),
      duration: 1.23449,
      fps: 29.97001,
    });

    expect(a.durationMs).toBe(1234);
    expect(a.streamSignature).toBe(b.streamSignature);
    expect(a.fingerprintKey).toBe(b.fingerprintKey);
  });
});
