import { describe, expect, it } from "vitest";
import {
  createPositionReporter,
  endedSample,
  type PositionReport,
} from "@/lib/positionReporter";

function setup(intervalMs = 5000) {
  let t = 0;
  const sent: PositionReport[] = [];
  const reporter = createPositionReporter((r) => sent.push(r), {
    intervalMs,
    now: () => t,
  });
  return {
    reporter,
    sent,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const at = (position: number) => ({ position, duration: 100 });

describe("createPositionReporter", () => {
  it("sends at most one routine report per interval while playing", () => {
    const { reporter, sent, advance } = setup();
    // timeupdate fires ~4×/s; 20 s of it is 80 ticks.
    for (let i = 0; i < 80; i++) {
      advance(250);
      reporter.tick(at(i / 4));
    }
    expect(sent.length).toBe(4);
    expect(sent.every((r) => !r.urgent)).toBe(true);
  });

  it("does not report the first ticks of a file (its start is still being applied)", () => {
    const { reporter, sent, advance } = setup();
    advance(100);
    reporter.tick(at(0));
    expect(sent).toEqual([]);
  });

  it("honours a shorter gap for seeks", () => {
    const { reporter, sent, advance } = setup();
    advance(1000);
    reporter.tick(at(30), 1000);
    advance(200);
    reporter.tick(at(40), 1000);
    expect(sent.map((r) => r.position)).toEqual([30]);
  });

  it("flushes the latest position at once, marked urgent", () => {
    const { reporter, sent, advance } = setup();
    advance(1000);
    reporter.tick(at(12));
    reporter.flush();
    expect(sent).toEqual([{ position: 12, duration: 100, urgent: true }]);
  });

  it("skips a flush that repeats the last urgent report", () => {
    const { reporter, sent } = setup();
    reporter.flush(at(12));
    reporter.flush(at(12.2));
    expect(sent.length).toBe(1);
    reporter.flush({ ...at(12.2), ended: true });
    expect(sent.length).toBe(2);
  });

  it("sends an urgent flush even right after the same position went out routinely", () => {
    const { reporter, sent, advance } = setup();
    advance(5000);
    reporter.tick(at(12));
    reporter.flush();
    expect(sent.map((r) => r.urgent)).toEqual([false, true]);
  });

  it("treats a duration learned since the last urgent report as news", () => {
    const { reporter, sent } = setup();
    reporter.flush({ position: 6, duration: null });
    // Same second, but now it is known to be 6 s of 7: that one is finished.
    reporter.flush({ position: 6, duration: 7 });
    expect(sent.map((r) => r.duration)).toEqual([null, 7]);
  });

  it("reports an end at the file's end, marked ended", () => {
    expect(endedSample({ position: 99.8, duration: 100 })).toEqual({
      position: 100,
      duration: 100,
      ended: true,
    });
    expect(endedSample({ position: 42, duration: null })).toEqual({
      position: 42,
      duration: null,
      ended: true,
    });
  });

  it("has nothing to flush before any position was seen", () => {
    const { reporter, sent } = setup();
    reporter.flush();
    expect(sent).toEqual([]);
  });
});
