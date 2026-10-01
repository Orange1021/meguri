export interface IdentityCandidate {
  videoId: string;
  strong: boolean;
}

export interface IdentityDecisionInput {
  currentVideoId: string;
  previousKey: string | null;
  currentKey: string;
  candidates: readonly IdentityCandidate[];
  strong: boolean;
}

export type IdentityDecision =
  | { kind: "keep" | "reuse" | "create"; videoId: string }
  | {
      kind: "conflict";
      issueType: "ambiguous_identity" | "duplicate_candidate" | "probe_failed";
      candidateVideoIds: string[];
    };

export function decideIdentity(
  input: IdentityDecisionInput,
): IdentityDecision {
  const byVideoId = new Map<string, boolean>();
  for (const candidate of input.candidates) {
    byVideoId.set(
      candidate.videoId,
      (byVideoId.get(candidate.videoId) ?? false) || candidate.strong,
    );
  }
  const candidateVideoIds = [...byVideoId.keys()].sort();

  if (
    input.strong &&
    input.previousKey !== null &&
    input.previousKey === input.currentKey
  ) {
    return { kind: "keep", videoId: input.currentVideoId };
  }

  if (!input.strong) {
    return {
      kind: "conflict",
      issueType: "probe_failed",
      candidateVideoIds,
    };
  }

  if (candidateVideoIds.length > 1) {
    return {
      kind: "conflict",
      issueType: "ambiguous_identity",
      candidateVideoIds,
    };
  }

  if (candidateVideoIds.length === 1) {
    const videoId = candidateVideoIds[0];
    if (byVideoId.get(videoId)) return { kind: "reuse", videoId };
    return {
      kind: "conflict",
      issueType: "probe_failed",
      candidateVideoIds,
    };
  }

  return { kind: "create", videoId: input.currentVideoId };
}
