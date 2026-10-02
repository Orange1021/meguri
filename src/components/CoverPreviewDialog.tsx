import { useEffect, useState, type WheelEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";

const COVER_ZOOM_MIN = 0.5;
const COVER_ZOOM_MAX = 4;
const COVER_ZOOM_STEP = 1.1;

function clampCoverZoom(value: number): number {
  return Math.min(COVER_ZOOM_MAX, Math.max(COVER_ZOOM_MIN, value));
}

export function CoverPreviewDialog({
  open,
  coverUrl,
  title,
  onOpenChange,
}: {
  open: boolean;
  coverUrl: string | null;
  title: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setFailedUrl(null);
    setZoom(1);
  }, [coverUrl, open]);

  const handleCoverWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    // The app's global content zoom also listens for Ctrl+wheel on window.
    // Keep pinch zoom inside the preview so the page behind the dialog stays
    // completely unchanged.
    event.preventDefault();
    event.stopPropagation();
    setZoom((current) =>
      clampCoverZoom(
        current * (event.deltaY < 0 ? COVER_ZOOM_STEP : 1 / COVER_ZOOM_STEP),
      ),
    );
  };

  const failed = !coverUrl || failedUrl === coverUrl;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(92vw,64rem)] border-border/70 bg-black/95 p-3 sm:rounded-xl"
        aria-describedby="cover-preview-description"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {t("media.coverPreviewTitle", { name: title })}
          </DialogTitle>
          <DialogDescription id="cover-preview-description">
            {title}
          </DialogDescription>
        </DialogHeader>
        <div
          data-testid="cover-preview-viewport"
          className="flex h-[min(78vh,42rem)] min-h-64 w-full items-center justify-center overflow-hidden rounded-lg bg-black"
          onWheel={handleCoverWheel}
        >
          {failed ? (
            <div
              role="status"
              className="px-6 py-16 text-center text-sm text-muted"
            >
              {t("media.coverPreviewFailed")}
            </div>
          ) : (
            <img
              src={coverUrl}
              alt={title}
              className="h-full w-full object-contain will-change-transform"
              style={{ transform: `scale(${zoom})` }}
              onError={() => setFailedUrl(coverUrl)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
