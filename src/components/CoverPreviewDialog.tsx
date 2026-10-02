import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const COVER_ZOOM_MIN = 0.5;
const COVER_ZOOM_MAX = 4;
const COVER_ZOOM_STEP = 1.1;
const COVER_PAN_KEY_STEP = 40;

function clampCoverZoom(value: number): number {
  return Math.min(COVER_ZOOM_MAX, Math.max(COVER_ZOOM_MIN, value));
}

interface CoverPan {
  x: number;
  y: number;
}

interface CoverDrag {
  pointerId: number;
  startX: number;
  startY: number;
  startPan: CoverPan;
}

const ZERO_PAN: CoverPan = { x: 0, y: 0 };

function clampCoverPan(
  value: CoverPan,
  zoom: number,
  viewport: HTMLDivElement,
  image: HTMLImageElement | null,
): CoverPan {
  if (zoom <= 1 || viewport.clientWidth <= 0 || viewport.clientHeight <= 0) {
    return zoom <= 1 ? ZERO_PAN : value;
  }

  const naturalWidth = image?.naturalWidth ?? 0;
  const naturalHeight = image?.naturalHeight ?? 0;
  const aspectRatio =
    naturalWidth > 0 && naturalHeight > 0
      ? naturalWidth / naturalHeight
      : viewport.clientWidth / viewport.clientHeight;
  const containedWidth = Math.min(
    viewport.clientWidth,
    viewport.clientHeight * aspectRatio,
  );
  const containedHeight = Math.min(
    viewport.clientHeight,
    viewport.clientWidth / aspectRatio,
  );
  const maxX = Math.max(0, (containedWidth * zoom - viewport.clientWidth) / 2);
  const maxY = Math.max(
    0,
    (containedHeight * zoom - viewport.clientHeight) / 2,
  );

  return {
    x: Math.min(maxX, Math.max(-maxX, value.x)),
    y: Math.min(maxY, Math.max(-maxY, value.y)),
  };
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
  const [pan, setPan] = useState<CoverPan>(ZERO_PAN);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<CoverDrag | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- A new dialog session must reset transient viewer state before interaction resumes. */
    setFailedUrl(null);
    setZoom(1);
    setPan(ZERO_PAN);
    setDragging(false);
    /* eslint-enable react-hooks/set-state-in-effect */
    dragRef.current = null;
  }, [coverUrl, open]);

  const clearCoverDrag = (viewport?: HTMLDivElement) => {
    const drag = dragRef.current;
    if (
      drag &&
      viewport?.hasPointerCapture?.(drag.pointerId) &&
      viewport.releasePointerCapture
    ) {
      viewport.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  };

  const applyCoverZoom = (nextZoom: number, viewport: HTMLDivElement) => {
    setZoom(nextZoom);
    setPan((current) =>
      clampCoverPan(current, nextZoom, viewport, imageRef.current),
    );
    if (nextZoom <= 1) clearCoverDrag(viewport);
  };

  const handleCoverWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey) return;
    // The app's global content zoom also listens for Ctrl+wheel on window.
    // Keep pinch zoom inside the preview so the page behind the dialog stays
    // completely unchanged.
    event.preventDefault();
    event.stopPropagation();
    const viewport = event.currentTarget;
    const nextZoom = clampCoverZoom(
      zoom * (event.deltaY < 0 ? COVER_ZOOM_STEP : 1 / COVER_ZOOM_STEP),
    );
    applyCoverZoom(nextZoom, viewport);
  };

  const handleCoverPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || event.button !== 0 || dragRef.current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPan: pan,
    };
    setDragging(true);
  };

  const handleCoverPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const viewport = event.currentTarget;
    setPan(
      clampCoverPan(
        {
          x: drag.startPan.x + event.clientX - drag.startX,
          y: drag.startPan.y + event.clientY - drag.startY,
        },
        zoom,
        viewport,
        imageRef.current,
      ),
    );
  };

  const finishCoverDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    clearCoverDrag(event.currentTarget);
  };

  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    clearCoverDrag();
  };

  const handleCoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    let keyboardZoom: number | null = null;
    if (event.key === "=" || event.key === "+") {
      keyboardZoom = clampCoverZoom(zoom * COVER_ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      keyboardZoom = clampCoverZoom(zoom / COVER_ZOOM_STEP);
    } else if (event.key === "0") {
      keyboardZoom = 1;
    }
    if (keyboardZoom !== null) {
      event.preventDefault();
      applyCoverZoom(keyboardZoom, viewport);
      return;
    }
    if (zoom <= 1) return;
    const step = event.shiftKey ? COVER_PAN_KEY_STEP * 2 : COVER_PAN_KEY_STEP;
    const delta = {
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
    }[event.key];
    if (!delta) return;

    event.preventDefault();
    const image = imageRef.current;
    setPan((current) =>
      clampCoverPan(
        { x: current.x + delta.x, y: current.y + delta.y },
        zoom,
        viewport,
        image,
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
          className={cn(
            "flex h-[min(78vh,42rem)] min-h-64 w-full items-center justify-center overflow-hidden rounded-lg bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            zoom > 1 &&
              (dragging
                ? "cursor-grabbing touch-none"
                : "cursor-grab touch-none"),
          )}
          aria-label={title}
          tabIndex={0}
          onWheel={handleCoverWheel}
          onPointerDown={handleCoverPointerDown}
          onPointerMove={handleCoverPointerMove}
          onPointerUp={finishCoverDrag}
          onPointerCancel={finishCoverDrag}
          onLostPointerCapture={handleLostPointerCapture}
          onKeyDown={handleCoverKeyDown}
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
              ref={imageRef}
              src={coverUrl}
              alt={title}
              draggable={false}
              className="h-full w-full select-none object-contain will-change-transform"
              style={{
                transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              }}
              onError={() => setFailedUrl(coverUrl)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
