import { describe, expect, it } from "vitest";
import {
  buildPotPlayerLaunch,
  discoverPotPlayer,
  type PlayerDiscoveryOptions,
} from "../player.js";

describe("PotPlayer adapter", () => {
  it("builds an argument array without shell quoting", () => {
    expect(
      buildPotPlayerLaunch("C:\\Program Files\\PotPlayer\\PotPlayerMini64.exe", "D:\\Data\\temp\\a b.m3u8"),
    ).toEqual({
      executable: "C:\\Program Files\\PotPlayer\\PotPlayerMini64.exe",
      args: ["D:\\Data\\temp\\a b.m3u8"],
    });
  });

  it("discovers an explicitly configured executable before common locations", () => {
    const options: PlayerDiscoveryOptions = {
      platform: "win32",
      env: { MEGURI_POTPLAYER_PATH: "D:\\Apps\\PotPlayerMini64.exe" },
      exists: (value) => value === "D:\\Apps\\PotPlayerMini64.exe",
    };
    expect(discoverPotPlayer(options)).toEqual({
      path: "D:\\Apps\\PotPlayerMini64.exe",
      source: "configured",
    });
  });

  it("returns null when not on Windows or no candidate exists", () => {
    expect(discoverPotPlayer({ platform: "linux", env: {}, exists: () => true })).toBeNull();
    expect(discoverPotPlayer({ platform: "win32", env: {}, exists: () => false })).toBeNull();
  });
});
