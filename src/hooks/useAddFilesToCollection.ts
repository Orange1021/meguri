// The write behind dropping files onto a collection in the rail: one
// membership call for the whole drop, then the same two refreshes every other
// membership write makes (the rail's counts, and any collection-scoped list).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import { groupBulkTargets } from "@/lib/bulkEdit";
import type { DraggedFile } from "@/lib/fileDrag";
import { invalidateCollectionSearches } from "@/lib/queryCache";

interface Drop {
  collectionId: string;
  /** Shown in the toast. */
  name: string;
  files: DraggedFile[];
}

/** Returns a factory for one collection's drop handler. */
export function useAddFilesToCollection(): (
  collectionId: string,
  name: string,
) => (files: DraggedFile[]) => void {
  const { t } = useI18n();
  const qc = useQueryClient();
  const add = useMutation({
    // decodeFileDrag already capped the drop at what one write may carry.
    mutationFn: ({ collectionId, files }: Drop) =>
      api.collectionSetMembership(collectionId, groupBulkTargets(files), "add"),
    onSuccess: ({ changed }, { name, files }) => {
      void qc.invalidateQueries({ queryKey: ["workspaces_list"] });
      invalidateCollectionSearches(qc);
      if (changed === 1) {
        toast.success(t("drop.addedOneToCollection", { name }));
      } else if (changed > 1) {
        toast.success(t("drop.addedToCollection", { count: changed, name }));
      } else {
        toast.info(
          files.length === 1
            ? t("drop.alreadyOneInCollection", { name })
            : t("drop.alreadyInCollection", { name }),
        );
      }
    },
    onError: (e) =>
      toast.error(t("drop.addToCollectionFailed"), {
        description: e instanceof Error ? e.message : String(e),
      }),
  });
  return (collectionId, name) => (files) =>
    add.mutate({ collectionId, name, files });
}
