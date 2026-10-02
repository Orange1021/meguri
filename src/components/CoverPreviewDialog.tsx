import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/i18n/I18nProvider";

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

  useEffect(() => {
    setFailedUrl(null);
  }, [coverUrl, open]);

  const failed = !coverUrl || failedUrl === coverUrl;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(92vw,72rem)] border-border/70 bg-black/95 p-3 sm:rounded-xl"
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
        <div className="flex max-h-[82vh] min-h-40 items-center justify-center overflow-hidden rounded-lg bg-black">
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
              className="max-h-[82vh] max-w-full object-contain"
              onError={() => setFailedUrl(coverUrl)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
