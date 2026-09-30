// Throttles playback-position reports on their way to the main process.
//
// A media element fires `timeupdate` several times a second; each report is an
// IPC round trip and, eventually, a SQLite write on the main thread. While
// playing, a report goes out at most once per interval; the moments that matter
// — pause, end, closing the player — go out at once and are marked urgent, so
// the main process writes them straight through (see PositionWriter) and a
// read that follows sees them. Pure, so the timing rules are testable without
// a DOM or a clock.

/** At most one routine report per this long while playing. */
export const POSITION_REPORT_INTERVAL_MS = 5_000;

/** At most one report per this long while seeking (a held arrow key). */
export const POSITION_SEEK_INTERVAL_MS = 1_000;

/** Positions closer than this count as the same (no report needed). */
const SAME_POSITION_SEC = 0.5;

export interface PositionSample {
  /** Seconds into the file. */
  position: number;
  /** The player's duration, when it knows one. */
  duration: number | null;
  /** Playback ran to the end. */
  ended?: boolean;
}

/**
 * The report for playback that ran to its end: the file's end as the
 * position (the element can stop a hair short of it), marked ended.
 */
export function endedSample(sample: PositionSample): PositionSample {
  return {
    position: sample.duration ?? sample.position,
    duration: sample.duration,
    ended: true,
  };
}

export interface PositionReport extends PositionSample {
  urgent: boolean;
}

export interface PositionReporter {
  /**
   * A position while playing (or just seeked to). Sent only once `minGapMs`
   * has passed since the last report; otherwise remembered, so a later
   * {@link flush} has it.
   */
  tick(sample: PositionSample, minGapMs?: number): void;
  /**
   * Send now, as urgent: pause, end, closing. Without a sample it sends the
   * last one seen. Skipped when the same report already went out as urgent
   * (a duration learned since then makes it a different report: it can change
   * whether the file counts as finished).
   */
  flush(sample?: PositionSample): void;
}

export function createPositionReporter(
  send: (report: PositionReport) => void,
  {
    intervalMs = POSITION_REPORT_INTERVAL_MS,
    now = Date.now,
  }: { intervalMs?: number; now?: () => number } = {},
): PositionReporter {
  // Starts at creation, not at -∞: the first `timeupdate`s of a file arrive
  // before its start position (a resume point, a `?t=`) has been applied, and
  // reporting that 0 would wipe the very resume point being restored.
  let lastSentAt = now();
  let latest: PositionSample | null = null;
  let lastUrgent: PositionSample | null = null;

  const emit = (sample: PositionSample, urgent: boolean) => {
    lastSentAt = now();
    lastUrgent = urgent ? sample : null;
    send({ ...sample, urgent });
  };

  return {
    tick(sample, minGapMs = intervalMs) {
      latest = sample;
      if (now() - lastSentAt < minGapMs) return;
      emit(sample, false);
    },
    flush(sample) {
      const s = sample ?? latest;
      if (!s) return;
      latest = s;
      if (
        lastUrgent &&
        Boolean(lastUrgent.ended) === Boolean(s.ended) &&
        lastUrgent.duration === s.duration &&
        Math.abs(lastUrgent.position - s.position) < SAME_POSITION_SEC
      )
        return;
      emit(s, true);
    },
  };
}
