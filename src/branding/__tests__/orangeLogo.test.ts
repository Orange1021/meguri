import { describe, expect, it } from "vitest";
import {
  ORANGE_LOGO_DATA_URL,
  ORANGE_LOGO_SVG,
} from "@shared/branding/orangeLogo";
import { LOGO_IDS } from "@shared/ipc/schema";

describe("orange branding", () => {
  it("exposes a single orange SVG source without the old character", () => {
    expect(LOGO_IDS).toEqual(["orange"]);
    expect(ORANGE_LOGO_SVG).toContain("<svg");
    expect(ORANGE_LOGO_SVG).toContain("<circle");
    expect(ORANGE_LOGO_SVG).toContain("#f97316");
    expect(ORANGE_LOGO_SVG).toContain("#4d7c0f");
    expect(ORANGE_LOGO_SVG).not.toContain("巡");
  });

  it("encodes the same SVG for img and nativeImage consumers", () => {
    expect(ORANGE_LOGO_DATA_URL).toMatch(
      /^data:image\/svg\+xml;charset=utf-8,/,
    );
    expect(decodeURIComponent(ORANGE_LOGO_DATA_URL.split(",", 2)[1])).toBe(
      ORANGE_LOGO_SVG,
    );
  });
});
