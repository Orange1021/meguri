import { describe, expect, it } from "vitest";
import {
  decodeFileDrag,
  dragPayload,
  encodeFileDrag,
  FILE_DRAG_MIME,
  isFileDrag,
} from "@/lib/fileDrag";
import { sampleFileRow } from "@/test/fixtures";
import { MAX_BULK_FILES } from "@shared/tags";
import type { FileRow } from "@/ipc/types";

const row = (workspaceId: string, id: number): FileRow => ({
  ...sampleFileRow,
  workspaceId,
  id,
});

describe("dragPayload", () => {
  const a = row("ws-a", 1);
  const b = row("ws-a", 2);
  const c = row("ws-b", 1);
  const sel = (
    rows: FileRow[],
    extra: { count?: number; pending?: boolean } = {},
  ) => ({
    rows,
    count: extra.count ?? rows.length,
    pending: extra.pending ?? false,
  });

  it("carries the whole selection when the dragged item is selected", () => {
    expect(dragPayload(b, sel([a, b, c]), true)).toEqual([
      { workspaceId: "ws-a", fileId: 1 },
      { workspaceId: "ws-a", fileId: 2 },
      { workspaceId: "ws-b", fileId: 1 },
    ]);
  });

  it("carries only the dragged item when it is not selected", () => {
    expect(dragPayload(c, sel([a, b]), false)).toEqual([
      { workspaceId: "ws-b", fileId: 1 },
    ]);
  });

  it("carries only the dragged item when nothing is selected", () => {
    expect(dragPayload(a, sel([]), false)).toEqual([
      { workspaceId: "ws-a", fileId: 1 },
    ]);
  });

  it("refuses while a selected folder's files are still being fetched", () => {
    // Dropping now would add only the rows already known and report success.
    expect(dragPayload(a, sel([a], { pending: true }), true)).toBe("pending");
  });

  it("refuses a selection larger than one write may carry", () => {
    // A folder cut short at the cap still counts all of its files.
    expect(
      dragPayload(a, sel([a, b], { count: MAX_BULK_FILES + 1 }), true),
    ).toBe("tooMany");
  });

  it("still drags an unselected item while the selection is pending", () => {
    expect(dragPayload(c, sel([a], { pending: true }), false)).toEqual([
      { workspaceId: "ws-b", fileId: 1 },
    ]);
  });
});

describe("encode / decode", () => {
  it("round-trips a payload", () => {
    const files = [
      { workspaceId: "ws-a", fileId: 1 },
      { workspaceId: "ws-b", fileId: 7 },
    ];
    expect(decodeFileDrag(encodeFileDrag(files))).toEqual(files);
  });

  it("drops duplicates", () => {
    expect(
      decodeFileDrag(
        JSON.stringify([
          { workspaceId: "ws-a", fileId: 1 },
          { workspaceId: "ws-a", fileId: 1 },
        ]),
      ),
    ).toEqual([{ workspaceId: "ws-a", fileId: 1 }]);
  });

  it.each([
    ["not JSON", "{"],
    ["not an array", JSON.stringify({ workspaceId: "ws-a", fileId: 1 })],
    ["empty", "[]"],
    ["missing workspace", JSON.stringify([{ fileId: 1 }])],
    ["empty workspace", JSON.stringify([{ workspaceId: "", fileId: 1 }])],
    ["non-integer id", JSON.stringify([{ workspaceId: "ws-a", fileId: 1.5 }])],
    ["zero id", JSON.stringify([{ workspaceId: "ws-a", fileId: 0 }])],
    ["string id", JSON.stringify([{ workspaceId: "ws-a", fileId: "1" }])],
    ["null entry", JSON.stringify([null])],
    [
      "more files than one write may carry",
      JSON.stringify(
        Array.from({ length: MAX_BULK_FILES + 1 }, (_, i) => ({
          workspaceId: "w",
          fileId: i + 1,
        })),
      ),
    ],
    ["oversized raw payload", " ".repeat(MAX_BULK_FILES * 128 + 1)],
  ])("rejects a malformed payload (%s)", (_label, raw) => {
    expect(decodeFileDrag(raw)).toBeNull();
  });
});

describe("isFileDrag", () => {
  it("recognizes only the app's own drag type", () => {
    expect(isFileDrag([FILE_DRAG_MIME])).toBe(true);
    expect(isFileDrag(["Files"])).toBe(false);
    expect(isFileDrag(["text/uri-list", "text/plain"])).toBe(false);
  });
});
