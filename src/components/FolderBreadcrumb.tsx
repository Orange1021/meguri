// The folder view's location: the workspace, then each folder down to the one
// shown. Every level but the current one is a way back up. A deep path keeps
// its first and last levels and folds the middle into a menu, so the bar never
// wraps and every level stays one click away.
import { ArrowLeft, ArrowUp, ChevronRight, MoreHorizontal } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/i18n/I18nProvider";
import { ROOT_FOLDER, splitFolderPath } from "@shared/folderPath";

/** Levels shown before the middle folds away (root included). */
const MAX_VISIBLE = 4;
/** Deepest levels kept visible when folding. */
const TAIL = 2;

interface Level {
  label: string;
  path: string;
}

export function FolderBreadcrumb({
  rootLabel,
  path,
  onNavigate,
  canGoBack,
  onBack,
  onUp,
}: {
  /** What the workspace root is called (the workspace's display name). */
  rootLabel: string;
  path: string;
  onNavigate: (path: string) => void;
  canGoBack: boolean;
  onBack: () => void;
  onUp: () => void;
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
  const folded =
    levels.length > MAX_VISIBLE ? levels.slice(1, levels.length - TAIL) : [];
  const shown =
    folded.length > 0 ? [levels[0], ...levels.slice(-TAIL)] : levels;
  const current = levels[levels.length - 1];

  return (
    <nav
      aria-label={t("folder.breadcrumbLabel")}
      className="flex min-w-0 items-center gap-0.5 border-b border-border bg-bg px-4 py-1 text-xs"
    >
      <NavButton
        label={t("folder.back")}
        disabled={!canGoBack}
        onClick={onBack}
      >
        <ArrowLeft className="size-3.5" />
      </NavButton>
      <NavButton
        label={t("folder.up")}
        disabled={path === ROOT_FOLDER}
        onClick={onUp}
      >
        <ArrowUp className="size-3.5" />
      </NavButton>
      {shown.map((level, i) => (
        <Fragment key={level.path}>
          {i > 0 && <Separator />}
          {i === 1 && folded.length > 0 && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={t("folder.more")}
                  title={t("folder.more")}
                  className="flex h-6 items-center rounded px-1 text-muted transition hover:bg-fg/10 hover:text-fg"
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
          {level === current ? (
            <span
              aria-current="page"
              title={level.label}
              className="min-w-0 truncate px-1 font-medium text-fg"
            >
              {level.label}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate(level.path)}
              title={level.label}
              className="h-6 min-w-0 max-w-48 shrink truncate rounded px-1 text-muted transition hover:bg-fg/10 hover:text-fg"
            >
              {level.label}
            </button>
          )}
        </Fragment>
      ))}
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
      className="flex size-6 shrink-0 items-center justify-center rounded text-muted transition hover:bg-fg/10 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
