import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

/**
 * Independent cover action for a media thumbnail. It deliberately stops the
 * event before it reaches a surrounding playback link/row.
 */
export function CoverPreviewButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = t("media.coverView");
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-7 rounded-md bg-bg/75 p-1 text-fg shadow-sm backdrop-blur-[1px] hover:bg-bg/90",
        className,
      )}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      title={label}
    >
      <Eye aria-hidden="true" />
    </Button>
  );
}
