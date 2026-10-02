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

  it("does not transcode audio rows or containers outside the MP4 family", () => {
    expect(shouldTranscodeForPlayback("mp4", "audio", "mpeg4", null)).toBe(
      false,
    );
    expect(shouldTranscodeForPlayback("mkv", "video", "mpeg4", null)).toBe(
      false,
    );
  });

  it("leaves files with unknown codec metadata on the existing path", () => {
    expect(shouldTranscodeForPlayback("mp4", "video", null, null)).toBe(false);
  });
});
