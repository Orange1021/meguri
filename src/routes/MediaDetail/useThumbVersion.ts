import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { events } from "@/ipc/client";
import { patchFileDetailInCache } from "@/lib/queryCache";

/**
 * Cache-bust the on-page main-thumbnail preview after regeneration. The main
 * process emits `thumb:done` once the attempt finishes; bumping the version
 * flips the `?v=` query and forces the browser to refetch the rewritten WebP.
 *
 * The event also projects the attempt result into the open detail cache: an
 * audio track opened while the scan was still extracting covers was fetched
 * with `hasThumb: 0`, and a failed restore must not create a broken URL.
 */
export function useThumbVersion(fileId: number, wsId: string): number {
  const qc = useQueryClient();
  const [thumbVersion, setThumbVersion] = useState(0);
  useEffect(() => {
    // The subscription resolves asynchronously; a cleanup that lands first
    // (StrictMode's replay, a quick prev/next) must still drop it once it
    // arrives, or the listener would outlive the file it was keyed on.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void events
      .onThumbDone((event) => {
        if (
          event.id === fileId &&
          (!event.workspaceId || event.workspaceId === wsId)
        ) {
          setThumbVersion((v) => v + 1);
          const ready = event.ready !== false;
          patchFileDetailInCache(qc, wsId, fileId, {
            thumbStatus: ready ? "done" : "error",
            hasThumb: ready ? 1 : 0,
          });
        }
      })
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [fileId, wsId, qc]);
  return thumbVersion;
}
