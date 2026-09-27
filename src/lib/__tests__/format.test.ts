import { describe, expect, it } from "vitest";
import { formatDuration, formatSize, resolutionBadge } from "@/lib/format";

describe("formatDuration", () => {
  it("returns the fallback for null / 0 / negative / NaN", () => {
    expect(formatDuration(null)).toBe("");
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(NaN)).toBe("");
  });

  it("honors a custom fallback string", () => {
    expect(formatDuration(null, { fallback: "—" })).toBe("—");
    expect(formatDuration(0, { hours: true, fallback: "—" })).toBe("—");
  });

  it("formats m:ss by default", () => {
    // Sub-second positive values fall through the falsy/<=0 guard and render as "0:00".
    expect(formatDuration(0.9)).toBe("0:00");
    expect(formatDuration(1)).toBe("0:01");
    expect(formatDuration(59)).toBe("0:59");
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(599)).toBe("9:59");
    // No hours rollover in the compact (list) form: 1h05m05s is rendered as 65:05.
    expect(formatDuration(3905)).toBe("65:05");
  });

  it("omits the hours field when hours:true but h=0", () => {
    expect(formatDuration(125, { hours: true })).toBe("2:05");
    expect(formatDuration(3599, { hours: true })).toBe("59:59");
  });

  it("includes hours when h>0 and zero-pads minutes/seconds", () => {
    expect(formatDuration(3600, { hours: true })).toBe("1:00:00");
    expect(formatDuration(3725, { hours: true })).toBe("1:02:05");
    expect(formatDuration(36005, { hours: true })).toBe("10:00:05");
  });
});

describe("formatSize", () => {
  it("returns the fallback for null / 0", () => {
    expect(formatSize(null)).toBe("");
    expect(formatSize(0)).toBe("");
    expect(formatSize(null, "—")).toBe("—");
    expect(formatSize(0, "—")).toBe("—");
  });

  it.each([
    [1, "1 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
    [1024 * 1024 * 1024, "1.0 GB"],
    // The unit table caps at GB; 1 TiB renders as "1024.0 GB" rather than rolling over.
    [1024 ** 4, "1024.0 GB"],
  ])("formatSize(%i) === %s", (input, expected) => {
    expect(formatSize(input)).toBe(expected);
  });
});

describe("resolutionBadge", () => {
  it("is empty when a dimension is unknown", () => {
    expect(resolutionBadge("video", null, 1080)).toBe("");
    expect(resolutionBadge("video", 1920, 0)).toBe("");
    expect(resolutionBadge("audio", null, null)).toBe("");
  });

  it("classes videos by the higher class either side reaches", () => {
    expect(resolutionBadge("video", 7680, 4320)).toBe("8K");
    expect(resolutionBadge("video", 3840, 2160)).toBe("4K");
    expect(resolutionBadge("video", 2560, 1440)).toBe("QHD");
    expect(resolutionBadge("video", 1920, 1080)).toBe("FHD");
    expect(resolutionBadge("video", 1080, 1920)).toBe("FHD");
    expect(resolutionBadge("video", 1280, 720)).toBe("HD");
    expect(resolutionBadge("video", 640, 480)).toBe("SD");
    // Letterboxed: the width alone reaches HD.
    expect(resolutionBadge("video", 1280, 534)).toBe("HD");
    expect(resolutionBadge("video", 3840, 1606)).toBe("4K");
  });

  it("gives images their megapixels", () => {
    expect(resolutionBadge("image", 6000, 4000)).toBe("24 MP");
    expect(resolutionBadge("image", 1920, 1080)).toBe("2.1 MP");
    expect(resolutionBadge("image", 640, 480)).toBe("0.3 MP");
    // Rounded before the one-decimal cut-off, and never "0.0".
    expect(resolutionBadge("image", 3648, 2736)).toBe("10 MP");
    expect(resolutionBadge("image", 100, 100)).toBe("<0.1 MP");
  });
});
