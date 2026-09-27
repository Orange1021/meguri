// A child folder in the folder view: a mosaic of what is inside, the folder's
// name and how much it holds.
//
// Shaped exactly like MediaGrid's media card — an aspect-video top and a
// metadata block of the same fixed height — because the grid sizes every row
// from one measured row. A folder card that were even a pixel taller or
// shorter would put every row after a mixed one out of place.
import { Folder } from "lucide-react";
import { memo, type MouseEvent } from "react";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import {
  isSelectionClick,
  useFolderSelection,
} from "@/components/SelectionContext";
import { FolderSelectionCheck } from "@/components/SelectionCheck";
import type { FileRow, FolderEntry } from "@/ipc/types";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

interface Props {
  entry: FolderEntry;
  mediaBase: string;
  /** workspaceId:id → thumb:done counter, the same map the media cards read. */
  thumbVersion: Record<string, number>;
  focused?: boolean;
  onOpen: (path: string) => void;
}

export const FolderCard = memo(function FolderCard({
  entry,
  mediaBase,
  thumbVersion,
  focused,
  onOpen,
}: Props) {
  const { t } = useI18n();
  const { active, selected, toggle } = useFolderSelection(entry.path);
  const count = t("folder.itemCount", { count: entry.count });
  // Same rule as a media card: while selecting every click picks, otherwise a
  // modified click does (and starts selecting). Shift has no range to draw
  // across folders, so it toggles like Ctrl.
  const open = (e: MouseEvent) => {
    if (isSelectionClick(active, e)) {
      e.preventDefault();
      toggle(entry);
      return;
    }
    onOpen(entry.path);
  };
  return (
    <div
      data-testid="folder-card"
      aria-current={focused ? "true" : undefined}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-primary",
        focused && "border-primary ring-2 ring-primary",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      {/* The mosaic opens the folder too; the name button below is the
          keyboard/screen-reader target, so this region stays out of the tab order. */}
      <div
        data-thumb
        onClick={open}
        className="group/thumb relative block aspect-video cursor-pointer overflow-hidden bg-overlay text-muted"
      >
        <Mosaic
          previews={entry.previews}
          mediaBase={mediaBase}
          thumbVersion={thumbVersion}
        />
        <span className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1 rounded bg-bg/75 px-1 py-0.5 text-[10px] text-fg backdrop-blur-[1px]">
          <Folder className="size-3.5 fill-current opacity-80" />
          {count}
        </span>
      </div>
      <FolderSelectionCheck
        entry={entry}
        className="absolute left-1 top-1 z-10"
      />
      {/* Same block as the media card's metadata: name, a second line, then
          empty slots the height of its rating row and tag row. */}
      <div className="flex flex-col gap-1 border-t border-border px-2 py-1.5">
        <button
          type="button"
          onClick={open}
          aria-label={t("folder.open", { name: entry.name })}
          title={entry.name}
          className="truncate text-left text-xs font-medium text-fg"
        >
          {entry.name}
        </button>
        <div className="truncate text-[10px] text-muted">{count}</div>
        <div aria-hidden className="h-[14px]" />
        <div aria-hidden className="h-6" />
      </div>
    </div>
  );
});

// Tiles by how many files the folder offered: one fills the frame, two sit
// side by side, three put one tall tile beside two, four make a 2×2.
const LAYOUT: Record<number, { grid: string; first?: string }> = {
  1: { grid: "grid-cols-1 grid-rows-1" },
  2: { grid: "grid-cols-2 grid-rows-1" },
  3: { grid: "grid-cols-2 grid-rows-2", first: "row-span-2" },
  4: { grid: "grid-cols-2 grid-rows-2" },
};

function Mosaic({
  previews,
  mediaBase,
  thumbVersion,
}: {
  previews: FileRow[];
  mediaBase: string;
  thumbVersion: Record<string, number>;
}) {
  const layout = LAYOUT[previews.length];
  if (!layout) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Folder className="size-10 opacity-60" />
      </div>
    );
  }
  return (
    <div
      data-testid="folder-mosaic"
      className={cn("absolute inset-0 grid gap-px bg-border", layout.grid)}
    >
      {previews.map((file, i) => (
        <div
          key={`${file.workspaceId}:${file.id}`}
          className={cn(
            "relative overflow-hidden bg-overlay",
            i === 0 && layout.first,
          )}
        >
          <MediaThumbnail
            file={file}
            mediaBase={mediaBase}
            version={thumbVersion[`${file.workspaceId}:${file.id}`] ?? 0}
            fallbackIconSize="size-5"
            showPlayOverlay={false}
            scrubPreview={false}
          />
        </div>
      ))}
    </div>
  );
}
