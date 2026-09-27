// The normalized folder path shared by both processes (shared/folderPath.ts).
// Kept under electron/ because the core project is the one that collects it.
import { describe, expect, it } from "vitest";
import {
  MAX_FOLDER_PATH,
  folderNameOf,
  isNormalizedFolderPath,
  joinFolder,
  parentOf,
  splitFolderPath,
} from "../../../shared/folderPath.js";

describe("isNormalizedFolderPath", () => {
  it.each(["", "a", "a/b", "a/b c/d", "50% off [draft]", "A_B", "絵文字😀/x"])(
    "accepts %j",
    (p) => {
      expect(isNormalizedFolderPath(p)).toBe(true);
    },
  );

  it.each(["/a", "a/", "a//b", ".", "..", "a/./b", "a/../b", "a\0b", "/"])(
    "rejects %j",
    (p) => {
      expect(isNormalizedFolderPath(p)).toBe(false);
    },
  );

  it("bounds the length", () => {
    expect(isNormalizedFolderPath("a".repeat(MAX_FOLDER_PATH))).toBe(true);
    expect(isNormalizedFolderPath("a".repeat(MAX_FOLDER_PATH + 1))).toBe(false);
  });
});

describe("path helpers", () => {
  it("splits into segments, the root into none", () => {
    expect(splitFolderPath("")).toEqual([]);
    expect(splitFolderPath("a")).toEqual(["a"]);
    expect(splitFolderPath("a/b c/d")).toEqual(["a", "b c", "d"]);
  });

  it("finds the parent, the root being its own", () => {
    expect(parentOf("")).toBe("");
    expect(parentOf("a")).toBe("");
    expect(parentOf("a/b/c")).toBe("a/b");
  });

  it("joins a child onto a parent", () => {
    expect(joinFolder("", "a")).toBe("a");
    expect(joinFolder("a/b", "c")).toBe("a/b/c");
  });

  it("names the folder by its last segment", () => {
    expect(folderNameOf("")).toBe("");
    expect(folderNameOf("a")).toBe("a");
    expect(folderNameOf("a/b c")).toBe("b c");
  });
});
