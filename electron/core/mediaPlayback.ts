import type { Kind } from "./types.js";

const MP4_FAMILY_EXTENSIONS = new Set(["mp4", "m4v", "mov"]);
const BASELINE_H264_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);

interface RawStream {
  codec_type?: unknown;
  pix_fmt?: unknown;
}

interface RawProbe {
  streams?: unknown;
}

/** Whether an extension names a container that is commonly used for MP4 video. */
export function isMp4FamilyExtension(fileExt: string): boolean {
  return MP4_FAMILY_EXTENSIONS.has(fileExt.toLowerCase());
}

/**
 * Decide whether a video should be converted to the browser baseline before
 * it is served. The scanner's codec is authoritative when present; unknown
 * metadata stays on the existing path so a file that is still being scanned
 * does not unexpectedly start an expensive transcode.
 */
export function shouldTranscodeForPlayback(
  fileExt: string,
  kind: Kind,
  codec: string | null,
  raw: unknown,
): boolean {
  if (kind !== "video" || !isMp4FamilyExtension(fileExt) || !codec) {
    return false;
  }
  if (codec.toLowerCase() !== "h264") return true;

  const pixFmt = firstVideoStream(raw)?.pix_fmt;
  return (
    typeof pixFmt === "string" &&
    !BASELINE_H264_PIXEL_FORMATS.has(pixFmt.toLowerCase())
  );
}

function firstVideoStream(raw: unknown): RawStream | null {
  const streams = (raw as RawProbe | null)?.streams;
  if (!Array.isArray(streams)) return null;
  const stream = streams.find(
    (candidate): candidate is RawStream =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as RawStream).codec_type === "video",
  );
  return stream ?? null;
}
