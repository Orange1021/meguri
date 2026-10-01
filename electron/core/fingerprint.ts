import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import type { Kind } from "./types.js";

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

export interface FingerprintBytes {
  size: number;
  firstHash: string | null;
  lastHash: string | null;
  fullHash: string | null;
}

export interface QuickFingerprint extends FingerprintBytes {
  algorithm: typeof FINGERPRINT_ALGORITHM;
  version: typeof FINGERPRINT_VERSION;
  durationMs: number | null;
  streamSignature: string;
  fingerprintKey: string;
}

export class FingerprintError extends Error {
  constructor(
    readonly code: "file-changed-during-read" | "short-read",
    message: string,
  ) {
    super(message);
    this.name = "FingerprintError";
  }
}

export async function quickFingerprint(
  file: string,
  metadata: FingerprintMetadata,
  expectedSize?: number,
): Promise<QuickFingerprint> {
  const handle = await fsp.open(file, "r");
  try {
    const initialSize = (await handle.stat()).size;
    if (expectedSize != null && initialSize !== expectedSize) {
      throw new FingerprintError(
        "file-changed-during-read",
        `expected ${expectedSize} bytes but found ${initialSize}`,
      );
    }

    let bytes: FingerprintBytes;
    if (initialSize <= FINGERPRINT_FULL_HASH_MAX_BYTES) {
      const full = await readRange(handle, initialSize, 0);
      const fullHash = sha256(full);
      bytes = {
        size: initialSize,
        firstHash: fullHash,
        lastHash: fullHash,
        fullHash,
      };
    } else {
      const first = await readRange(handle, FINGERPRINT_WINDOW_BYTES, 0);
      const last = await readRange(
        handle,
        FINGERPRINT_WINDOW_BYTES,
        initialSize - FINGERPRINT_WINDOW_BYTES,
      );
      bytes = {
        size: initialSize,
        firstHash: sha256(first),
        lastHash: sha256(last),
        fullHash: null,
      };
    }

    const finalSize = (await handle.stat()).size;
    if (finalSize !== initialSize) {
      throw new FingerprintError(
        "file-changed-during-read",
        `file size changed from ${initialSize} to ${finalSize}`,
      );
    }
    return buildFingerprintKey(metadata, bytes);
  } finally {
    await handle.close();
  }
}

export function buildFingerprintKey(
  metadata: FingerprintMetadata,
  bytes: FingerprintBytes = {
    size: 0,
    firstHash: null,
    lastHash: null,
    fullHash: null,
  },
): QuickFingerprint {
  const durationMs = normalizeDurationMs(metadata.duration);
  const streamSignature = JSON.stringify({
    kind: metadata.kind,
    codec: metadata.codec,
    width: metadata.width,
    height: metadata.height,
    fpsMilli: normalizeFpsMilli(metadata.fps),
  });
  const canonical = JSON.stringify([
    `${FINGERPRINT_ALGORITHM}-${FINGERPRINT_VERSION}`,
    bytes.size,
    durationMs,
    bytes.firstHash,
    bytes.lastHash,
    bytes.fullHash,
    streamSignature,
  ]);
  return {
    algorithm: FINGERPRINT_ALGORITHM,
    version: FINGERPRINT_VERSION,
    ...bytes,
    durationMs,
    streamSignature,
    fingerprintKey: sha256(Buffer.from(canonical, "utf8")),
  };
}

function normalizeDurationMs(duration: number | null): number | null {
  if (duration == null || !Number.isFinite(duration)) return null;
  return Math.round(Math.max(0, duration) * 1000);
}

function normalizeFpsMilli(fps: number | null): number | null {
  if (fps == null || !Number.isFinite(fps)) return null;
  return Math.round(Math.max(0, fps) * 1000);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readRange(
  handle: fsp.FileHandle,
  length: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const result = await handle.read(
      buffer,
      offset,
      length - offset,
      position + offset,
    );
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  if (offset !== length) {
    throw new FingerprintError(
      "short-read",
      `expected ${length} bytes but read ${offset}`,
    );
  }
  return buffer;
}
