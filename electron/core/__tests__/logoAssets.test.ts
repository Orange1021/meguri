import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORANGE_LOGO_DATA_URL,
  ORANGE_TRAY_ICON_DATA_URL,
} from "../logoAssets.js";

describe("main-process logo asset", () => {
  it("exports the shared orange SVG data URL", () => {
    expect(ORANGE_LOGO_DATA_URL).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
    expect(decodeURIComponent(ORANGE_LOGO_DATA_URL.split(",", 2)[1])).toContain(
      "<svg",
    );
    expect(ORANGE_LOGO_DATA_URL).not.toContain("iVBOR");
  });

  it("exports a raster PNG data URL for the Windows tray", () => {
    expect(ORANGE_TRAY_ICON_DATA_URL).toMatch(
      /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/,
    );
    const payload = ORANGE_TRAY_ICON_DATA_URL.split(",", 2)[1];
    const png = Buffer.from(payload, "base64");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it("embeds the reviewable orange tray PNG without stale bytes", () => {
    const expected = fs.readFileSync(
      path.resolve(process.cwd(), "logo", "tray-32.png"),
    );
    const actual = Buffer.from(
      ORANGE_TRAY_ICON_DATA_URL.split(",", 2)[1],
      "base64",
    );

    expect(actual).toEqual(expected);
  });
});
