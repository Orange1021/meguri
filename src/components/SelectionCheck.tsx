// The per-row selection checkbox, shared by the grid and list views.
//
// Visible on hover (and always once it is checked or focused), so the affordance
// is discoverable without putting a permanent box on every card. It is a real
// button with aria-pressed rather than an <input type="checkbox">: it sits
// inside the card's link, where a labelled input has nowhere to put its label,
// and the surrounding hit area already carries the same toggle.
import { Check } from "lucide-react";
import { useIsSelected, useSelectionMode } from "@/components/SelectionContext";
import { useI18n } from "@/i18n/I18nProvider";
import type { FileRow } from "@/ipc/types";
import { cn } from "@/lib/utils";

interface Props {
  file: FileRow;
  /** Index within the loaded list — what a Shift-click measures its range from. */
  index: number;
  className?: string;
}

export function SelectionCheck({ file, index, className }: Props) {
  const { t } = useI18n();
  // Per-value subscriptions: this box re-renders when its own row is picked or
  // when selection mode turns on, not on every click elsewhere in the list.
  const { active, click } = useSelectionMode();
  const checked = useIsSelected(file);
  return (
    <button
      type="button"
      // Prevent the surrounding Link / row click from navigating.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        click(file, index, e);
      }}
      aria-pressed={checked}
      aria-label={checked ? t("select.deselectFile") : t("select.selectFile")}
      title={checked ? t("select.deselectFile") : t("select.selectFile")}
      className={cn(
        "flex size-[18px] items-center justify-center rounded border transition",
        checked
          ? "border-primary bg-primary text-primary-foreground opacity-100"
          : "border-fg/70 bg-bg/60 text-transparent opacity-0 backdrop-blur-[1px] focus-visible:opacity-100 group-hover:opacity-100",
        // Once selecting, every box stays out so the selection can be read at a
        // glance instead of one card at a time.
        active && "opacity-100",
        className,
      )}
    >
      <Check className="size-3" strokeWidth={3.5} />
    </button>
  );
}
