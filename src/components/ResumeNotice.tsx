// "Resumed from 12:34 · Start over": shown when a file opened at its stored
// resume point rather than at the top, with the way back to zero one click
// away. Shared by the detail view and the playlist player.
import { RotateCcw } from "lucide-react";
import type { TFunc } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";
import { fmtTime } from "@/routes/MediaDetail/utils";

export function ResumeNotice({
  sec,
  onStartOver,
  className,
  t,
}: {
  /** Where playback resumed, in seconds. */
  sec: number;
  onStartOver: () => void;
  className?: string;
  t: TFunc;
}) {
  return (
    <div
      data-slot="resume-notice"
      role="status"
      className={cn(
        "flex w-fit items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs text-muted",
        className,
      )}
    >
      <span>{t("player.resumedFrom", { time: fmtTime(sec) })}</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onStartOver}
        className="inline-flex items-center gap-1 font-medium text-fg hover:underline"
      >
        <RotateCcw className="size-3" aria-hidden="true" />
        {t("player.startOver")}
      </button>
    </div>
  );
}
