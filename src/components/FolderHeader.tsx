// The folder view's location, as a header: the folder shown, large and marked
// with the folder colour, the path above it as a line of links back up, and
// on the right what the folder holds and a way to open it in the OS file
// manager. A deep path keeps the root and the
// nearest level and folds the middle into a menu, so the line never wraps and
// every level stays one click away.
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
} from "lucide-react";
import { Fragment, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { ROOT_FOLDER, splitFolderPath } from "@shared/folderPath";

/** Levels above the current one shown before the middle folds away. */
const MAX_ANCESTORS = 3;

interface Level {
  label: string;
  path: string;
}

export function FolderHeader({
  rootLabel,
  path,
  onNavigate,
  canGoBack,
  onBack,
  onUp,
  summary,
  onOpenInFileManager,
}: {
  /** What the workspace root is called (the workspace's display name). */
  rootLabel: string;
  path: string;
  onNavigate: (path: string) => void;
  canGoBack: boolean;
  onBack: () => void;
  onUp: () => void;
  /** What the folder holds ("7 folders · 8 files"); omitted while unknown. */
  summary?: string;
  /** Opens the folder shown in the OS file manager. */
  onOpenInFileManager: () => void;
}) {
  const { t } = useI18n();
  const segments = splitFolderPath(path);
  const levels: Level[] = [
    { label: rootLabel, path: ROOT_FOLDER },
    ...segments.map((label, i) => ({
      label,
      path: segments.slice(0, i + 1).join("/"),
    })),
  ];
  const current = levels[levels.length - 1];
  const ancestors = levels.slice(0, -1);
  const folded = ancestors.length > MAX_ANCESTORS ? ancestors.slice(1, -1) : [];
  const shown =
    folded.length > 0
      ? [ancestors[0], ancestors[ancestors.length - 1]]
      : ancestors;

  return (
    <nav
      aria-label={t("folder.breadcrumbLabel")}
      className="flex h-14 min-w-0 items-center gap-3 border-b border-border bg-bg px-4"
    >
      <div className="flex shrink-0 items-center gap-0.5">
        <NavButton
          label={t("folder.back")}
          disabled={!canGoBack}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </NavButton>
        <NavButton
          label={t("folder.up")}
          disabled={path === ROOT_FOLDER}
          onClick={onUp}
        >
          <ArrowUp className="size-4" />
        </NavButton>
      </div>
      <Folder
        aria-hidden
        className="size-5 shrink-0 fill-accent2 text-accent2"
      />
      <div className="flex min-w-0 flex-col">
        {shown.length > 0 && (
          <div className="flex min-w-0 items-center gap-0.5 text-[11px] text-muted">
            {shown.map((level, i) => (
              <Fragment key={level.path}>
                {i === 1 && folded.length > 0 && (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        aria-label={t("folder.more")}
                        title={t("folder.more")}
                        className="flex h-4 items-center rounded px-0.5 transition hover:bg-fg/10 hover:text-fg"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {folded.map((f) => (
                          <DropdownMenuItem
                            key={f.path}
                            onSelect={() => onNavigate(f.path)}
                          >
                            {f.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Separator />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate(level.path)}
                  title={level.label}
                  className="h-4 min-w-0 max-w-48 shrink truncate rounded leading-4 transition hover:text-fg hover:underline"
                >
                  {level.label}
                </button>
                <Separator />
              </Fragment>
            ))}
          </div>
        )}
        <span
          aria-current="page"
          title={current.label}
          className="truncate text-base font-bold leading-5 text-bright-fg"
        >
          {current.label}
        </span>
      </div>
      <div className="flex-1" />
      {summary && (
        <span className="shrink-0 text-xs text-muted">{summary}</span>
      )}
      <button
        type="button"
        onClick={onOpenInFileManager}
        title={t("folder.openInFileManager")}
        className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-fg transition hover:bg-fg/10"
      >
        <FolderOpen aria-hidden className="size-3.5" />
        {t("folder.openInFileManager")}
      </button>
    </nav>
  );
}

function Separator() {
  return <ChevronRight aria-hidden className="size-3 shrink-0 text-muted/70" />;
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-fg transition hover:bg-fg/10 disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
