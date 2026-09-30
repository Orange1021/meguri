// Reports where playback of one file stands, for the resume point (see
// shared/resume.ts). Shared by the video player (detail view and playlist) and
// the audio bar; each owns one of these per file it plays.
//
// Nothing is reported until the caller says the file actually played in this
// visit (`markPlayed`): a file merely opened — paused on arrival, or failing to
// load — must not overwrite the resume point it was opened at, nor the position
// of an earlier play in the history.
import { useLayoutEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/ipc/client";
import log from "@/lib/logger";
import {
  createPositionReporter,
  type PositionReporter,
  type PositionSample,
} from "@/lib/positionReporter";
import {
  invalidateInProgressSearches,
  patchFileDetailInCache,
  patchFileRowInCaches,
} from "@/lib/queryCache";
import { resumePointOf, resumeProgressOf } from "@shared/resume";

export interface PlaybackPosition {
  /** The file started playing in this visit; reports flow from here on. */
  markPlayed: () => void;
  tick: PositionReporter["tick"];
  flush: PositionReporter["flush"];
}

export function usePlaybackPosition(
  wsId: string | null | undefined,
  fileId: number | null | undefined,
  /** False turns reporting off (e.g. a player that must not record). */
  enabled = true,
): PlaybackPosition {
  const qc = useQueryClient();
  const target =
    enabled && wsId && fileId != null && Number.isFinite(fileId)
      ? { wsId, fileId }
      : null;
  const key = target ? `${target.wsId}:${target.fileId}` : "";

  // One reporter per file visit. `played` lives beside it so a new file starts
  // unplayed without a reset step that could race the old file's last report.
  const visit = useMemo(() => {
    if (!target) return null;
    const { wsId: ws, fileId: id } = target;
    const state = { played: false };
    const reporter = createPositionReporter((report) => {
      const { urgent, ...sample } = report;
      void api
        .fileSavePosition(id, ws, report)
        .then(() => {
          if (!urgent) return;
          // An urgent report is written by the time this resolves. It moved
          // the newest play's position, which the history timeline shows.
          void qc.invalidateQueries({ queryKey: ["history_list"] });
          // A file played to its end leaves "In progress". Done now rather
          // than on leaving: the audio bar keeps a finished track loaded
          // until another replaces it. A pause stays out of it, so the list
          // under a paused player does not reshuffle.
          if (sample.ended) invalidateInProgressSearches(qc);
        })
        .catch((e: unknown) => log.warn("save playback position failed:", e));
      // Only the reports that settle something are mirrored into the caches:
      // a progress bar need not creep along every few seconds, and a pause or
      // a close is when the list is looked at again.
      if (!urgent) return;
      const resume = resumePointOf(
        sample.position,
        sample.duration,
        sample.ended,
      );
      const patch = {
        resumePosition: resume,
        progress: resumeProgressOf(resume, sample.duration),
      };
      patchFileRowInCaches(qc, ws, id, patch);
      patchFileDetailInCache(qc, ws, id, patch);
    });
    return { state, reporter, ws, id };
    // `target` is rebuilt every render; the key is what identifies it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, qc]);

  // Leaving the file (switching to another, closing the player): report where
  // it was left — the reporter holds the last position seen, which every
  // `timeupdate` refreshes — then let lists filtered on "In progress" pick up
  // the change. Their membership is left alone while the file plays so the
  // list under the player does not shift.
  //
  // Layout effects, here and below: they run within the commit, so no media
  // event can land between the switch to a new file and the reporter
  // following it — a `timeupdate` of the new file must never be booked
  // against the old one (it would report the new file's 0 as where the old one
  // was left).
  useLayoutEffect(() => {
    if (!visit) return;
    return () => {
      if (!visit.state.played) return;
      visit.reporter.flush();
      invalidateInProgressSearches(qc);
      // The duplicates screen lists file rows with their progress too, but
      // outside the caches patched above.
      void qc.invalidateQueries({ queryKey: ["duplicates_list"] });
    };
  }, [visit, qc]);

  const visitRef = useRef(visit);
  useLayoutEffect(() => {
    visitRef.current = visit;
  }, [visit]);

  // Stable across renders: media event handlers call these, and they read the
  // current visit through the ref.
  return useMemo<PlaybackPosition>(
    () => ({
      markPlayed: () => {
        if (visitRef.current) visitRef.current.state.played = true;
      },
      tick: (sample: PositionSample, minGapMs?: number) => {
        const v = visitRef.current;
        if (v?.state.played) v.reporter.tick(sample, minGapMs);
      },
      flush: (sample?: PositionSample) => {
        const v = visitRef.current;
        if (v?.state.played) v.reporter.flush(sample);
      },
    }),
    [],
  );
}
