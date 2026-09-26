// Regression tests for bulkEditManualTags: the one write behind the selection
// bar's tag editor. What matters here is that the counters report real changes,
// that a partially-tagged selection converges, and that FTS follows.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../db.js";
import { addManualTag, bulkEditManualTags, fileTags } from "../tags.js";
import { searchFiles } from "../queries.js";
import { insertFile, newDb } from "./helpers.js";

describe("bulkEditManualTags", () => {
  let db: DB;
  let rootId: number;
  let ids: number[];

  beforeEach(() => {
    ({ db, rootId } = newDb());
    ids = ["a.mp4", "b.mp4", "c.mp4"].map((relPath, i) =>
      insertFile(db, rootId, { relPath, contentHash: `h${i}` }),
    );
  });
  afterEach(() => db.close());

  const namesOf = (id: number) =>
    fileTags(db, id)
      .map((t) => t.name)
      .sort();

  it("attaches a new tag to every file and reports the pairs it wrote", () => {
    const r = bulkEditManualTags(db, ids, ["beach"], []);
    expect(r).toEqual({ files: 3, skipped: 0, added: 3, removed: 0 });
    for (const id of ids) expect(namesOf(id)).toEqual(["beach"]);
  });

  it("counts only files the edit actually changed", () => {
    addManualTag(db, ids[0], "beach");
    const r = bulkEditManualTags(db, ids, ["beach"], []);
    // The file that already had it is untouched: 2 pairs, 2 files.
    expect(r).toEqual({ files: 2, skipped: 0, added: 2, removed: 0 });
  });

  it("re-applying an edit that changes nothing is a no-op", () => {
    bulkEditManualTags(db, ids, ["beach"], []);
    expect(bulkEditManualTags(db, ids, ["beach"], [])).toEqual({
      files: 0,
      skipped: 0,
      added: 0,
      removed: 0,
    });
  });

  it("levels a partially-applied tag up across the whole selection", () => {
    addManualTag(db, ids[1], "trip");
    const r = bulkEditManualTags(db, ids, ["trip"], []);
    expect(r.added).toBe(2);
    for (const id of ids) expect(namesOf(id)).toEqual(["trip"]);
  });

  it("removes a tag from every file that had it, ignoring those that did not", () => {
    addManualTag(db, ids[0], "trip");
    addManualTag(db, ids[2], "trip");
    const r = bulkEditManualTags(db, ids, [], ["trip"]);
    expect(r).toEqual({ files: 2, skipped: 0, added: 0, removed: 2 });
    for (const id of ids) expect(namesOf(id)).toEqual([]);
  });

  it("ignores a removal of a name no tag row matches", () => {
    expect(bulkEditManualTags(db, ids, [], ["nothing-here"])).toEqual({
      files: 0,
      skipped: 0,
      added: 0,
      removed: 0,
    });
  });

  it("treats a name in both lists as an addition, with no churn", () => {
    addManualTag(db, ids[0], "keep");
    const r = bulkEditManualTags(db, ids, ["keep"], ["keep"]);
    for (const id of ids) expect(namesOf(id)).toEqual(["keep"]);
    // The file that already had it is left alone rather than being stripped
    // and re-tagged: the request describes a final state.
    expect(r).toEqual({ files: 2, skipped: 0, added: 2, removed: 0 });
  });

  describe("files sharing a content hash", () => {
    // Two rows, one metadata identity: meta_tags is keyed by meta_key, so a tag
    // written for one is a tag on both.
    let twinA: number;
    let twinB: number;
    beforeEach(() => {
      twinA = insertFile(db, rootId, {
        relPath: "dup-a.mp4",
        contentHash: "d",
      });
      twinB = insertFile(db, rootId, {
        relPath: "dup-b.mp4",
        contentHash: "d",
      });
    });

    it("counts both copies and keeps both FTS rows in step on add", () => {
      const r = bulkEditManualTags(db, [twinA, twinB], ["beach"], []);
      // One meta_tags row written, but two files the user selected moved.
      expect(r).toEqual({ files: 2, skipped: 0, added: 1, removed: 0 });
      expect(namesOf(twinA)).toEqual(["beach"]);
      expect(namesOf(twinB)).toEqual(["beach"]);
      expect(searchFiles(db, { q: "beach" }).items.map((f) => f.id)).toEqual([
        twinA,
        twinB,
      ]);
    });

    it("keeps both FTS rows in step on remove", () => {
      bulkEditManualTags(db, [twinA, twinB], ["beach"], []);
      bulkEditManualTags(db, [twinA, twinB], [], ["beach"]);
      expect(namesOf(twinA)).toEqual([]);
      expect(searchFiles(db, { q: "beach" }).items).toEqual([]);
    });

    it("re-indexes a twin that was not itself selected", () => {
      // Only one copy is selected, but the tag lands on the shared identity, so
      // the other copy's search text has to follow.
      bulkEditManualTags(db, [twinA], ["beach"], []);
      expect(searchFiles(db, { q: "beach" }).items.map((f) => f.id)).toEqual([
        twinA,
        twinB,
      ]);
    });
  });

  it("counts a missing file row as skipped rather than failing the edit", () => {
    db.prepare("DELETE FROM files WHERE id = ?").run(ids[1]);
    const r = bulkEditManualTags(db, ids, ["beach"], []);
    expect(r).toEqual({ files: 2, skipped: 1, added: 2, removed: 0 });
  });

  it("keeps the FTS index in step in both directions", () => {
    bulkEditManualTags(db, ids, ["vacation"], []);
    expect(searchFiles(db, { q: "vacation" }).items.map((f) => f.id)).toEqual(
      ids,
    );
    bulkEditManualTags(db, ids, [], ["vacation"]);
    expect(searchFiles(db, { q: "vacation" }).items).toEqual([]);
  });

  it("deduplicates names and file ids", () => {
    const r = bulkEditManualTags(
      db,
      [ids[0], ids[0], ids[1]],
      ["beach", "beach", " beach "],
      [],
    );
    expect(r).toEqual({ files: 2, skipped: 0, added: 2, removed: 0 });
    expect(namesOf(ids[0])).toEqual(["beach"]);
  });

  it("refuses a reserved name before writing anything", () => {
    expect(() => bulkEditManualTags(db, ids, ["res:4k"], [])).toThrow();
    for (const id of ids) expect(namesOf(id)).toEqual([]);
    expect(
      (db.prepare("SELECT COUNT(*) c FROM tags").get() as { c: number }).c,
    ).toBe(0);
  });

  it("does nothing when neither list has a name", () => {
    expect(bulkEditManualTags(db, ids, [], [])).toEqual({
      files: 0,
      skipped: 0,
      added: 0,
      removed: 0,
    });
  });
});
