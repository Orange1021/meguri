// Where a file opens: an explicit `?t=` first, then the stored resume point
// (when the preference allows), then the top — see resolveStartAt.
//
// Settled once per visit of a file and then held: the resume point in the
// cache moves while the file plays (usePlaybackPosition patches it), and the
// player's start position — and the notice saying where it resumed — must not
// chase it.
import { useState } from "react";
import { usePreferences } from "@/settings/PreferencesProvider";
import { resolveStartAt } from "@shared/resume";

interface Settled {
  key: string;
  startAt: number;
  resumed: boolean;
}

export interface ResumeStart {
  startAt: number;
  /** The stored resume point was taken (the "start over" notice shows). */
  resumed: boolean;
  /** Hide the notice (the user started over). */
  dismiss: () => void;
}

export function useResumeStart({
  visitKey,
  explicit,
  resume,
}: {
  /** Identifies one visit of one file; null while the file is not known yet. */
  visitKey: string | null;
  /** `?t=` or any other position the caller was handed. */
  explicit: number | null | undefined;
  /** The file's stored resume point. */
  resume: number | null | undefined;
}): ResumeStart {
  const { resumePlayback } = usePreferences();
  const [settled, setSettled] = useState<Settled | null>(null);
  let current = settled;
  if (visitKey != null && settled?.key !== visitKey) {
    current = {
      key: visitKey,
      ...resolveStartAt({ explicit, resume, enabled: resumePlayback }),
    };
    // Adjusting state while rendering (React's documented pattern for state
    // derived from a prop change): the render sees the new value at once.
    setSettled(current);
  }
  if (visitKey == null || current == null) {
    return {
      ...resolveStartAt({ explicit, resume: null, enabled: false }),
      dismiss: () => undefined,
    };
  }
  const key = current.key;
  return {
    startAt: current.startAt,
    resumed: current.resumed,
    dismiss: () =>
      setSettled((s) => (s?.key === key ? { ...s, resumed: false } : s)),
  };
}
