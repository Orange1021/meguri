import { describe, expect, it } from "vitest";
import { shouldTranscodeForPlayback } from "../mediaPlayback.js";

describe("shouldTranscodeForPlayback", () => {
  it("transcodes a non-H.264 video in an MP4-family container", () => {
    expect(
      shouldTranscodeForPlayback("mp4", "video", "mpeg4", {
        streams: [{ codec_type: "video", codec_name: "mpeg4" }],
      }),
    ).toBe(true);
  });

  it("transcodes H.264 with a non-baseline pixel format", () => {
    expect(
      shouldTranscodeForPlayback("mov", "video", "h264", {
        streams: [{ codec_type: "video", pix_fmt: "yuv420p10le" }],
      }),
    ).toBe(true);
  });

  it("keeps baseline H.264 MP4 video on the raw Range path", () => {
    expect(
      shouldTranscodeForPlayback("mp4", "video", "h264", {
        streams: [{ codec_type: "video", pix_fmt: "yuv420p" }],
      }),
    ).toBe(false);
  });

  it("does not transcode audio rows or unknown video metadata", () => {
    expect(shouldTranscodeForPlayback("mp4", "audio", "mpeg4", null)).toBe(
      false,
    );
    expect(shouldTranscodeForPlayback("mkv", "video", null, null)).toBe(
      false,
    );
  });

  it("transcodes MPEG-4 Part 2 video in an AVI container", () => {
    expect(
      shouldTranscodeForPlayback("avi", "video", "mpeg4", {
        streams: [
          { codec_type: "video", codec_name: "mpeg4", pix_fmt: "yuv420p" },
        ],
      }),
    ).toBe(true);
  });

  it("keeps baseline H.264/AAC in an AVI container on the copy path", () => {
    expect(
      shouldTranscodeForPlayback("avi", "video", "h264", {
        streams: [
          { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      }),
    ).toBe(false);
  });

  it("transcodes H.264 when the audio stream is not AAC", () => {
    expect(
      shouldTranscodeForPlayback("avi", "video", "h264", {
        streams: [
          { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p" },
          { codec_type: "audio", codec_name: "ac3" },
        ],
      }),
    ).toBe(true);
  });

  it("leaves files with unknown codec metadata on the existing path", () => {
    expect(shouldTranscodeForPlayback("mp4", "video", null, null)).toBe(false);
  });
});
