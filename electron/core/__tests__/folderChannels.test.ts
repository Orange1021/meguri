// The IPC payload contract for the folder view: folder paths are validated at
// the boundary, so a malformed one never reaches the range a query builds.
import { describe, expect, it } from "vitest";
import { ChannelInputs } from "../../../shared/ipc/channels.js";
import { SearchQuerySchema } from "../../../shared/ipc/schema.js";
import {
  MAX_FOLDER_FILES_PATHS,
  MAX_FOLDER_PATH,
} from "../../../shared/folderPath.js";

const BAD = [
  "/a",
  "a/",
  "a//b",
  "a/../b",
  ".",
  "a\0b",
  "a".repeat(MAX_FOLDER_PATH + 1),
];
const GOOD = ["", "a", "a/b c/絵文字😀", "50% off [draft]"];

describe("folders_list payload", () => {
  it.each(BAD)("rejects the malformed path %#", (path) => {
    expect(
      ChannelInputs.folders_list.safeParse({ workspaceId: "w", path }).success,
    ).toBe(false);
  });

  it.each(GOOD)("accepts %j", (path) => {
    expect(
      ChannelInputs.folders_list.safeParse({ workspaceId: "w", path }).success,
    ).toBe(true);
  });

  it("requires a workspace", () => {
    expect(
      ChannelInputs.folders_list.safeParse({ workspaceId: "", path: "" })
        .success,
    ).toBe(false);
  });
});

describe("files_search folder scope", () => {
  it.each(BAD)("rejects the malformed path %#", (path) => {
    expect(
      SearchQuerySchema.safeParse({ folder: { path, recursive: false } })
        .success,
    ).toBe(false);
  });

  it("accepts a normalized path and requires the recursion flag", () => {
    expect(
      SearchQuerySchema.safeParse({ folder: { path: "a/b", recursive: true } })
        .success,
    ).toBe(true);
    expect(SearchQuerySchema.safeParse({ folder: { path: "a" } }).success).toBe(
      false,
    );
  });
});

describe("folder_files payload", () => {
  const parse = (paths: unknown) =>
    ChannelInputs.folder_files.safeParse({ workspaceId: "w", paths }).success;

  it("accepts a list of distinct folders", () => {
    expect(parse(["a", "b/c"])).toBe(true);
  });

  it("rejects an empty, oversized, duplicated or malformed list", () => {
    expect(parse([])).toBe(false);
    expect(
      parse(
        Array.from({ length: MAX_FOLDER_FILES_PATHS + 1 }, (_, i) => `f${i}`),
      ),
    ).toBe(false);
    expect(parse(["a", "a"])).toBe(false);
    expect(parse(["a", "../b"])).toBe(false);
  });
});
