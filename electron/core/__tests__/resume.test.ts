// Resume points: the shared finished/start rules (shared/resume.ts), how a
// position report lands in the DB (savePlayPosition), how list rows and the
// "In progress" filter read it back, and the main-process write coalescing
// (PositionWriter).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "../db.js";
import {
  clearPlayHistory,
  fileDetail,
  recordPlay,
  savePlayPosition,
  searchFiles,
} from "../queries.js";
import { PositionWriter } from "../positionWriter.js";
import {
  isFinishedAt,
  resolveStartAt,
  resumePointOf,
  resumeProgressOf,
} from "../../../shared/resume.js";
import { insertFile, newDb } from "./helpers.js";

describe("finished threshold", () => {
  it("counts the last few percent as finished", () => {
    expect(isFinishedAt(950, 1000)).toBe(true);
    expect(isFinishedAt(949, 1000)).toBe(false);
  });

  it("also counts the last few seconds of a short clip as finished", () => {
    // 95% of 20 s is 19 s; the margin reaches back to 17 s.
    expect(isFinishedAt(17, 20)).toBe(true);
    expect(isFinishedAt(16, 20)).toBe(false);
  });

  it("never calls a file of unknown length finished", () => {
    expect(isFinishedAt(10_000, null)).toBe(false);
    expect(isFinishedAt(10_000, 0)).toBe(false);
  });

  it("stores no resume point once finished, ended, or barely begun", () => {
    expect(resumePointOf(500, 1000)).toBe(500);
    expect(resumePointOf(960, 1000)).toBeNull();
    expect(resumePointOf(500, 1000, true)).toBeNull();
    expect(resumePointOf(4, 1000)).toBeNull();
    expect(resumePointOf(5, 1000)).toBe(5);
    expect(resumePointOf(Number.NaN, 1000)).toBeNull();
    // Unknown length: kept, however far in.
    expect(resumePointOf(5000, null)).toBe(5000);
  });

  it("derives progress only when both values are known", () => {
    expect(resumeProgressOf(250, 1000)).toBe(0.25);
    expect(resumeProgressOf(null, 1000)).toBeNull();
    expect(resumeProgressOf(250, null)).toBeNull();
    expect(resumeProgressOf(2000, 1000)).toBe(1);
  });
});

describe("startAt precedence", () => {
  it("lets an explicit ?t= win over the stored position", () => {
    expect(
      resolveStartAt({ explicit: 42, resume: 300, enabled: true }),
    ).toEqual({ startAt: 42, resumed: false });
  });

  it("falls back to the stored position when nothing explicit was given", () => {
    expect(resolveStartAt({ explicit: 0, resume: 300, enabled: true })).toEqual(
      { startAt: 300, resumed: true },
    );
    expect(
      resolveStartAt({ explicit: undefined, resume: 300, enabled: true }),
    ).toEqual({ startAt: 300, resumed: true });
  });

  it("starts from zero when resuming is turned off or nothing is stored", () => {
    expect(
      resolveStartAt({ explicit: 0, resume: 300, enabled: false }),
    ).toEqual({ startAt: 0, resumed: false });
    expect(
      resolveStartAt({ explicit: 0, resume: null, enabled: true }),
    ).toEqual({ startAt: 0, resumed: false });
  });
});

describe("savePlayPosition", () => {
  let db: DB;
  let rootId: number;
  beforeEach(() => {
    ({ db, rootId } = newDb());
  });
  afterEach(() => db.close());

  /** Positions oldest entry first. Read by id: both plays land in the same
   *  second, so played_at alone would not order them. */
  const positions = () =>
    db.prepare("SELECT position FROM play_history ORDER BY id").pluck().all();

  it("moves the newest in-app play's position and stores the resume point", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4", duration: 1000 });
    recordPlay(db, id, "browser", 0);
    recordPlay(db, id, "browser", 0);
    expect(savePlayPosition(db, id, { position: 400 })).toBe(400);

    // Only the newer entry moved.
    expect(positions()).toEqual([0, 400]);
    const row = fileDetail(db, id)!;
    expect(row.resumePosition).toBe(400);
    expect(row.progress).toBeCloseTo(0.4);
  });

  it("leaves an external launch's entry alone", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4", duration: 1000 });
    recordPlay(db, id, "browser", 0);
    recordPlay(db, id, "external", null);
    savePlayPosition(db, id, { position: 400 });
    const history = fileDetail(db, id)!.playHistory;
    expect(history.find((p) => p.via === "external")?.position).toBeNull();
    expect(history.find((p) => p.via === "browser")?.position).toBe(400);
  });

  it("clears the resume point once the file is finished", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4", duration: 1000 });
    recordPlay(db, id, "browser", 0);
    savePlayPosition(db, id, { position: 400 });
    expect(savePlayPosition(db, id, { position: 990 })).toBeNull();
    expect(fileDetail(db, id)!.resumePosition).toBeNull();
    expect(fileDetail(db, id)!.progress).toBeNull();

    savePlayPosition(db, id, { position: 400 });
    savePlayPosition(db, id, { position: 400, ended: true });
    expect(fileDetail(db, id)!.resumePosition).toBeNull();
  });

  it("judges finished against the player's duration when the DB has none", () => {
    const id = insertFile(db, rootId, { relPath: "a.mkv", duration: null });
    expect(
      savePlayPosition(db, id, { position: 99, duration: 100 }),
    ).toBeNull();
    expect(savePlayPosition(db, id, { position: 50, duration: 100 })).toBe(50);
    // No duration on the row, so no progress fraction either.
    expect(fileDetail(db, id)!.progress).toBeNull();
  });

  it("does nothing for a file that is gone", () => {
    expect(savePlayPosition(db, 999, { position: 50 })).toBeUndefined();
  });

  it("feeds the In progress filter and list rows", () => {
    const a = insertFile(db, rootId, { relPath: "a.mp4", duration: 100 });
    const b = insertFile(db, rootId, { relPath: "b.mp4", duration: 100 });
    insertFile(db, rootId, { relPath: "c.mp4", duration: 100 });
    savePlayPosition(db, a, { position: 50 });
    savePlayPosition(db, b, { position: 99 });

    const inProgress = searchFiles(db, { inProgress: true }).items;
    expect(inProgress.map((f) => f.id)).toEqual([a]);
    expect(inProgress[0].resumePosition).toBe(50);
    expect(inProgress[0].progress).toBeCloseTo(0.5);

    const all = searchFiles(db, {}).items;
    expect(all.find((f) => f.id === b)?.resumePosition).toBeNull();
  });

  it("is wiped along with the play history", () => {
    const id = insertFile(db, rootId, { relPath: "a.mp4", duration: 1000 });
    recordPlay(db, id, "browser", 0);
    savePlayPosition(db, id, { position: 400 });
    clearPlayHistory(db);
    expect(fileDetail(db, id)!.resumePosition).toBeNull();
    expect(searchFiles(db, { inProgress: true }).items).toEqual([]);
  });
});

describe("PositionWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces routine reports into the latest one per file", () => {
    const writes: string[] = [];
    const w = new PositionWriter(() => undefined, 1000);
    w.queue("ws:1", () => writes.push("1@10"));
    w.queue("ws:1", () => writes.push("1@15"));
    w.queue("ws:2", () => writes.push("2@5"));
    expect(writes).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual(["1@15", "2@5"]);
    expect(w.size).toBe(0);
  });

  it("writes an urgent report at once, taking anything held along", () => {
    const writes: string[] = [];
    const w = new PositionWriter(() => undefined, 1000);
    w.queue("ws:2", () => writes.push("2@5"));
    w.queue("ws:1", () => writes.push("1@20"), true);
    expect(writes).toEqual(["2@5", "1@20"]);
    // Nothing left for the timer to do.
    vi.advanceTimersByTime(1000);
    expect(writes).toEqual(["2@5", "1@20"]);
  });

  it("keeps writing past a failing write and reports it", () => {
    const onError = vi.fn();
    const writes: string[] = [];
    const w = new PositionWriter(onError, 1000);
    w.queue("gone:1", () => {
      throw new Error("no such workspace");
    });
    w.queue("ws:1", () => writes.push("1@20"));
    w.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(writes).toEqual(["1@20"]);
  });
});
