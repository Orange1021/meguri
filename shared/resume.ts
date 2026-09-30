// Resume points: where a video or track was left, so the next open picks it up
// there. Both processes need the same rule — main decides what to store, the
// renderer patches its caches with what main is about to store — so it lives
// here rather than being spelled out on each side.

/** Past this fraction of the duration a file counts as watched to the end. */
export const RESUME_FINISHED_RATIO = 0.95;

/**
 * Also finished within this many seconds of the end. For a short clip the
 * ratio alone leaves a sliver too thin to be worth coming back to (5% of 20 s
 * is one second).
 */
export const RESUME_END_MARGIN_SEC = 3;

/**
 * Below this many seconds in there is nothing worth resuming: starting over
 * loses next to nothing, and a stream would pay for a re-encode from `?t=` only
 * to land back where the file begins.
 */
export const RESUME_MIN_SEC = 5;

/** Upper bound on a reported position or duration (a week, in seconds). */
export const MAX_MEDIA_SEC = 7 * 24 * 60 * 60;

/** Whether `position` is close enough to the end to call the file finished. */
export function isFinishedAt(
  position: number,
  duration: number | null | undefined,
): boolean {
  if (duration == null || !Number.isFinite(duration) || duration <= 0)
    return false;
  return (
    position >= duration * RESUME_FINISHED_RATIO ||
    duration - position <= RESUME_END_MARGIN_SEC
  );
}

/**
 * The resume point to store for a file stopped at `position`, or null to clear
 * it: a file that ended or is within the last few percent starts from zero next
 * time, and so does one barely begun.
 */
export function resumePointOf(
  position: number,
  duration: number | null | undefined,
  ended = false,
): number | null {
  if (ended || !Number.isFinite(position)) return null;
  if (position < RESUME_MIN_SEC) return null;
  if (isFinishedAt(position, duration)) return null;
  return position;
}

/** How far into the file a resume point sits, 0..1, or null when unknown. */
export function resumeProgressOf(
  resume: number | null | undefined,
  duration: number | null | undefined,
): number | null {
  if (resume == null || duration == null || !(duration > 0)) return null;
  return Math.min(1, Math.max(0, resume / duration));
}

/**
 * Where to start a file: an explicit `?t=` (a scene click, a bookmark, the
 * playlist handing over its position) always wins; otherwise the stored resume
 * point when resuming is on; otherwise the top. `resumed` says whether the
 * resume point was the one taken, which is when the "start over" notice shows.
 */
export function resolveStartAt({
  explicit,
  resume,
  enabled,
}: {
  explicit: number | null | undefined;
  resume: number | null | undefined;
  enabled: boolean;
}): { startAt: number; resumed: boolean } {
  if (explicit != null && Number.isFinite(explicit) && explicit > 0)
    return { startAt: explicit, resumed: false };
  if (enabled && resume != null && Number.isFinite(resume) && resume > 0)
    return { startAt: resume, resumed: true };
  return { startAt: 0, resumed: false };
}
