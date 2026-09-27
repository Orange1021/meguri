// Names the folder a queue is drawn from — Discovery's picks, the playlist's
// order — so a short or unexpected queue explains itself. The label comes
// from useFolderScopeLabel ("Music / YouTube"; the workspace alone for its root).
import { Folder } from "lucide-react";
import { cn } from "@/lib/utils";

export function FolderScopeChip({
  label,
  description,
  className,
}: {
  /** What useFolderScopeLabel spelled. */
  label: string;
  /** The full sentence, for the tooltip and screen readers. */
  description: string;
  className?: string;
}) {
  return (
    <span
      data-testid="folder-scope"
      title={description}
      aria-label={description}
      className={cn(
        "pointer-events-auto flex min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-bg/60 px-2.5 py-0.5 text-xs text-bright-fg backdrop-blur-md",
        className,
      )}
    >
      <Folder
        aria-hidden
        className="size-3.5 shrink-0 fill-accent2 text-accent2"
      />
      <span className="truncate">{label}</span>
    </span>
  );
}
