import { describe, expect, it } from "vitest";
import { splitDroppedItems } from "@/hooks/useOsFolderDrop";

function item(kind: "dir" | "file" | "string" | "unreadable") {
  const file = new File([], kind);
  return {
    kind: kind === "string" ? "string" : "file",
    getAsFile: () => (kind === "string" ? null : file),
    webkitGetAsEntry: () =>
      kind === "unreadable"
        ? null
        : ({ isDirectory: kind === "dir" } as FileSystemEntry),
  };
}

describe("splitDroppedItems", () => {
  it("separates folders from everything else", () => {
    const { dirs, others } = splitDroppedItems([
      item("dir"),
      item("file"),
      item("dir"),
      item("unreadable"),
    ]);
    expect(dirs.map((f) => f.name)).toEqual(["dir", "dir"]);
    expect(others).toBe(2);
  });

  it("ignores non-file items such as dragged text", () => {
    expect(splitDroppedItems([item("string")])).toEqual({
      dirs: [],
      others: 0,
    });
  });
});
