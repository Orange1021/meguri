// Natural file-name order. SQLite compares text byte by byte, which puts
// "clip-10" before "clip-9"; sort=name orders on files.sort_key instead, and
// the All view's merge re-implements the same order in JS.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { searchFiles, sortValueOf } from "../queries.js";
import { nameSortKey } from "../nameSort.js";
import { insertFile, newDb } from "./helpers.js";

/** Byte order, the way SQLite's BINARY collation compares the stored keys. */
const byKey = (a: string, b: string) =>
  nameSortKey(a) < nameSortKey(b)
    ? -1
    : nameSortKey(a) > nameSortKey(b)
      ? 1
      : 0;

describe("nameSortKey", () => {
  it("orders a digit run by its value, not by its first character", () => {
    const paths = ["clip-10.mp4", "clip-9.mp4", "clip-2.mp4"];
    expect([...paths].sort(byKey)).toEqual([
      "clip-2.mp4",
      "clip-9.mp4",
      "clip-10.mp4",
    ]);
  });

  it("treats each digit run on its own, folder names included", () => {
    const paths = ["S2/Ep10.mp4", "S2/Ep9.mp4", "S10/Ep1.mp4"];
    expect([...paths].sort(byKey)).toEqual([
      "S2/Ep9.mp4",
      "S2/Ep10.mp4",
      "S10/Ep1.mp4",
    ]);
  });

  it("folds case so Alpha and alpha are neighbours", () => {
    expect(nameSortKey("Alpha.mp4")).toBe(nameSortKey("alpha.mp4"));
  });

  it("folds case for a name without numbers too", () => {
    expect(nameSortKey("Movies/Holiday.MKV")).toBe("movies/holiday.mkv");
  });
});

describe("sort=name", () => {
  let db: DB;
  let rootId: number;

  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  const names = (rows: { relPath: string }[]) => rows.map((r) => r.relPath);

  it("orders 9 before 10", () => {
    for (const name of ["clip-10.mp4", "clip-9.mp4", "clip-2.mp4"]) {
      insertFile(db, rootId, { relPath: name });
    }
    const page = searchFiles(db, { sort: "name", sortDir: "asc", limit: 10 });
    expect(names(page.items)).toEqual([
      "clip-2.mp4",
      "clip-9.mp4",
      "clip-10.mp4",
    ]);
  });

  it("keeps a folder's files together and orders the folders by number", () => {
    for (const name of ["S10/a.mp4", "S2/b.mp4", "S2/a.mp4", "S9/c.mp4"]) {
      insertFile(db, rootId, { relPath: name });
    }
    const page = searchFiles(db, { sort: "name", sortDir: "asc", limit: 10 });
    expect(names(page.items)).toEqual([
      "S2/a.mp4",
      "S2/b.mp4",
      "S9/c.mp4",
      "S10/a.mp4",
    ]);
  });

  it("walks the order backwards for the descending direction", () => {
    for (const name of ["clip-2.mp4", "clip-9.mp4", "clip-10.mp4"]) {
      insertFile(db, rootId, { relPath: name });
    }
    const page = searchFiles(db, { sort: "name", sortDir: "desc", limit: 10 });
    expect(names(page.items)).toEqual([
      "clip-10.mp4",
      "clip-9.mp4",
      "clip-2.mp4",
    ]);
  });

  it("hands the seek key back in the same form the column holds", () => {
    const id = insertFile(db, rootId, { relPath: "clip-9.mp4" });
    const page = searchFiles(db, { sort: "name", sortDir: "asc", limit: 10 });
    const row = page.items.find((r) => r.id === id)!;
    const stored = db
      .prepare("SELECT sort_key AS key FROM files WHERE id = ?")
      .get(id) as { key: string };
    expect(stored.key).toBe(sortValueOf("name", row));
  });
});
