// Shared "nothing to show" panel for the grid / list / table views.
// Extracted so the copy stays identical across all three, and so lists that are
// not scan-backed (Watch Later) can explain themselves instead of telling the
// user to run a scan that would never populate them.
import { Clock, FolderSearch, ImageIcon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

export function MediaEmptyState({
  watchLater = false,
  inFolder = false,
}: {
  /** Whether the built-in Watch Later collection is the active view. */
  watchLater?: boolean;
  /**
   * A search scoped to the folder being viewed came back empty. Scanning would
   * not help; widening the search (or searching further up) would.
   */
  inFolder?: boolean;
}) {
  const { t } = useI18n();
  const Icon = watchLater ? Clock : inFolder ? FolderSearch : ImageIcon;
  const [title, hint] = watchLater
    ? [t("watchLater.empty"), t("watchLater.emptyHint")]
    : inFolder
      ? [t("folder.emptySearch"), t("folder.emptySearchHint")]
      : [t("grid.empty"), t("grid.emptyHint")];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
      <Icon className="size-10 opacity-50" />
      <p>{title}</p>
      <p className="max-w-md text-center text-xs">{hint}</p>
    </div>
  );
}
