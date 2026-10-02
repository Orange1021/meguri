import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_DISPLAY_MODE,
  VIDEO_DISPLAY_MODE_STORAGE_KEY,
  readVideoDisplayMode,
  writeVideoDisplayMode,
} from "@/video/videoDisplayMode";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

describe("video display mode storage", () => {
  it("defaults to contain when a video has no saved preference", () => {
    expect(readVideoDisplayMode("workspace-a", "file-1", createStorage())).toBe(
      DEFAULT_VIDEO_DISPLAY_MODE,
    );
  });

  it("stores each video preference independently", () => {
    const storage = createStorage();

    writeVideoDisplayMode("workspace-a", "file-1", "cover", storage);
    writeVideoDisplayMode("workspace-a", "file-2", "fill", storage);

    expect(readVideoDisplayMode("workspace-a", "file-1", storage)).toBe(
      "cover",
    );
    expect(readVideoDisplayMode("workspace-a", "file-2", storage)).toBe("fill");
    expect(readVideoDisplayMode("workspace-b", "file-1", storage)).toBe(
      "contain",
    );
  });

  it("round-trips all supported modes", () => {
    const storage = createStorage();

    for (const mode of ["contain", "cover", "fill"] as const) {
      writeVideoDisplayMode("workspace-a", mode, mode, storage);
      expect(readVideoDisplayMode("workspace-a", mode, storage)).toBe(mode);
    }
  });

  it("ignores malformed or invalid stored values", () => {
    const storage = createStorage();

    storage.setItem(VIDEO_DISPLAY_MODE_STORAGE_KEY, "not-json");
    expect(readVideoDisplayMode("workspace-a", "file-1", storage)).toBe(
      "contain",
    );

    storage.setItem(
      VIDEO_DISPLAY_MODE_STORAGE_KEY,
      JSON.stringify({ "workspace-a": { "file-1": "diagonal" } }),
    );
    expect(readVideoDisplayMode("workspace-a", "file-1", storage)).toBe(
      "contain",
    );

    storage.setItem(VIDEO_DISPLAY_MODE_STORAGE_KEY, JSON.stringify(["cover"]));
    expect(readVideoDisplayMode("workspace-a", "file-1", storage)).toBe(
      "contain",
    );
  });
});
