// Tag-name completion for a text input, shared by the single-file tag editor
// and the bulk editor so the debounce, the result count and the failure
// behaviour cannot drift between them.
//
// A failed lookup yields no suggestions rather than an error: completion is an
// assist, and the name the user typed is still accepted.
import { useEffect, useState } from "react";
import { api } from "@/ipc/client";

/** How long typing settles before a lookup runs. */
const DEBOUNCE_MS = 150;
/** Names offered at once. Enough to recognise one, short enough to scan. */
const LIMIT = 8;

export function useTagSuggestions(
  /** Database the names come from. Undefined while none is resolved yet. */
  workspaceId: string | undefined,
  input: string,
): string[] {
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const prefix = input.trim();
    if (!prefix || !workspaceId) {
      // Clearing synchronously, alongside the updates inside the debounced
      // fetch below, is what keeps a stale list from lingering under an empty
      // field — which is why setState in this effect is legitimate here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestions([]);
      return;
    }
    // Cancelling the timer is not enough on its own: once a lookup is in flight,
    // its answer can arrive after the input or the workspace has moved on and
    // overwrite the suggestions for what the user is typing now.
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .tagsList(workspaceId, prefix, LIMIT)
        .then((names) => {
          if (!cancelled) setSuggestions(names);
        })
        .catch(() => {
          if (!cancelled) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, workspaceId]);

  return suggestions;
}
