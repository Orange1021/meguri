import { describe, expect, it } from "vitest";
import {
  bulkFlagOf,
  bulkTargets,
  bulkToggleTarget,
  uniformRating,
} from "@/lib/bulkEdit";
import { sampleFileRow } from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";

const row = (over: Partial<FileRow> = {}): FileRow => ({
  ...sampleFileRow,
  ...over,
});

describe("bulkTargets", () => {
  it("groups the selection by workspace, keeping order", () => {
    expect(
      bulkTargets([
        row({ id: 1, workspaceId: "ws-a" }),
        row({ id: 2, workspaceId: "ws-b" }),
        row({ id: 3, workspaceId: "ws-a" }),
      ]),
    ).toEqual([
      { workspaceId: "ws-a", fileIds: [1, 3] },
      { workspaceId: "ws-b", fileIds: [2] },
    ]);
  });

  it("returns nothing for an empty selection", () => {
    expect(bulkTargets([])).toEqual([]);
  });
});

describe("bulkFlagOf", () => {
  const favorite = (row: FileRow) => !!row.favorite;

  it("reports all, some or none, with the counts the bar shows", () => {
    expect(
      bulkFlagOf([row({ favorite: 1 }), row({ favorite: 1 })], favorite),
    ).toEqual({ flag: "all", on: 2, total: 2 });
    expect(
      bulkFlagOf([row({ favorite: 1 }), row({ favorite: 0 })], favorite),
    ).toEqual({ flag: "some", on: 1, total: 2 });
    expect(bulkFlagOf([row({ favorite: 0 })], favorite)).toEqual({
      flag: "none",
      on: 0,
      total: 1,
    });
  });

  it("treats an empty selection as none", () => {
    expect(bulkFlagOf([], favorite)).toEqual({
      flag: "none",
      on: 0,
      total: 0,
    });
  });
});

describe("bulkToggleTarget", () => {
  it("levels a mixed selection up rather than clearing it", () => {
    // Reaching for the control means "make the selection this", so only a
    // selection that is already uniformly on turns off.
    expect(bulkToggleTarget("some")).toBe(true);
    expect(bulkToggleTarget("none")).toBe(true);
    expect(bulkToggleTarget("all")).toBe(false);
  });
});

describe("uniformRating", () => {
  it("returns the shared rating", () => {
    expect(uniformRating([row({ rating: 4 }), row({ rating: 4 })])).toBe(4);
  });

  it("returns null when the selection disagrees", () => {
    expect(uniformRating([row({ rating: 4 }), row({ rating: 2 })])).toBeNull();
  });

  it("counts an unrated selection as agreeing on zero", () => {
    expect(uniformRating([row({ rating: 0 }), row({ rating: 0 })])).toBe(0);
    expect(uniformRating([])).toBe(0);
  });
});
