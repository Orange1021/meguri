import { describe, expect, it } from "vitest";
import { tallySelectionTags } from "@/lib/bulkTags";
import { sampleFileRow } from "@/test/fixtures";
import type { FileRow, TagInfo } from "@/ipc/types";

const manual = (id: number, name: string): TagInfo => ({
  id,
  name,
  namespace: "",
  source: "manual",
  score: null,
});

const row = (id: number, tags: TagInfo[], workspaceId = "ws-a"): FileRow => ({
  ...sampleFileRow,
  id,
  workspaceId,
  tags,
});

describe("tallySelectionTags", () => {
  it("counts how many of the selected rows carry each name", () => {
    expect(
      tallySelectionTags([
        row(1, [manual(10, "beach"), manual(11, "trip")]),
        row(2, [manual(10, "beach")]),
        row(3, [manual(10, "beach")]),
      ]),
    ).toEqual([
      { name: "beach", count: 3 },
      { name: "trip", count: 1 },
    ]);
  });

  it("puts the most widely shared first, then sorts by name", () => {
    expect(
      tallySelectionTags([
        row(1, [manual(1, "zed"), manual(2, "alpha"), manual(3, "solo")]),
        row(2, [manual(1, "zed"), manual(2, "alpha")]),
      ]).map((t) => t.name),
    ).toEqual(["alpha", "zed", "solo"]);
  });

  it("counts a name once per row even when two sources carry it", () => {
    const twice: TagInfo[] = [
      manual(10, "beach"),
      { ...manual(10, "beach"), source: "plugin" },
    ];
    expect(tallySelectionTags([row(1, twice)])).toEqual([
      { name: "beach", count: 1 },
    ]);
  });

  it("leaves out a tag only a pipeline put there", () => {
    // The edit removes source='manual' rows only, so offering a plugin-only
    // tag would put a remove button on something the apply cannot touch.
    const pluginOnly: TagInfo[] = [
      { id: 20, name: "scenery", namespace: "", source: "plugin", score: null },
    ];
    expect(tallySelectionTags([row(1, pluginOnly)])).toEqual([]);
  });

  it("leaves out generated tags, which are not editable here", () => {
    const withAuto: TagInfo[] = [
      manual(10, "beach"),
      {
        id: 11,
        name: "4k",
        namespace: "res",
        source: "auto-meta",
        score: null,
      },
      // A namespace-less auto-meta tag would still be hidden by its source.
      { id: 12, name: "long", namespace: "", source: "auto-meta", score: null },
    ];
    expect(tallySelectionTags([row(1, withAuto)])).toEqual([
      { name: "beach", count: 1 },
    ]);
  });

  it("treats a row with no tags field as untagged", () => {
    expect(tallySelectionTags([{ ...sampleFileRow, tags: undefined }])).toEqual(
      [],
    );
  });
});
