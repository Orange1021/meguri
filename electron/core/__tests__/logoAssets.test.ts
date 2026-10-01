import { describe, expect, it } from "vitest";
import { ORANGE_LOGO_DATA_URL } from "../logoAssets.js";

describe("main-process logo asset", () => {
  it("exports the shared orange SVG data URL", () => {
    expect(ORANGE_LOGO_DATA_URL).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
    expect(decodeURIComponent(ORANGE_LOGO_DATA_URL.split(",", 2)[1])).toContain(
      '<svg',
    );
    expect(ORANGE_LOGO_DATA_URL).not.toContain("iVBOR");
  });
});
