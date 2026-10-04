// Settings: About section. Shows the app version / runtime versions and the
// bundled third-party license attributions. The FFmpeg/FFprobe entry matters
// legally: the bundled binaries are GPL-licensed, so the attributions stay
// visible here. This build carries no outbound links at all — the full license
// texts live with the source (LICENSE and src/assets/fonts/emoji/LICENSES.md).
import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, type AboutInfo } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";

interface ThirdPartyEntry {
  name: string;
  license: string;
}

// Notices for software bundled in the distributed app (not mere build tooling).
const THIRD_PARTY: ThirdPartyEntry[] = [
  // The ffmpeg/ffprobe executables are GPL builds of FFmpeg. The attribution is
  // what the GPL corresponding-source obligation rests on, so it stays even
  // though this section no longer links anywhere.
  {
    name: "FFmpeg / FFprobe (bundled binaries)",
    license: "GPL-3.0",
  },
  { name: "ffmpeg-static (npm)", license: "GPL-3.0-or-later" },
  { name: "@derhuerst/ffprobe-static (npm)", license: "GPL-3.0-or-later" },
  { name: "Electron (Chromium / Node.js)", license: "MIT" },
  { name: "better-sqlite3", license: "MIT" },
  { name: "React", license: "MIT" },
  // Bundled emoji fonts for the selectable emoji styles
  // (details in src/assets/fonts/emoji/LICENSES.md).
  { name: "Twemoji Mozilla (emoji font)", license: "CC-BY 4.0 / Apache-2.0" },
  { name: "Noto Emoji (emoji font)", license: "OFL-1.1" },
  { name: "OpenMoji (emoji font)", license: "CC BY-SA 4.0" },
];

export function AboutSection() {
  const { t } = useI18n();
  const [info, setInfo] = useState<AboutInfo | null>(null);

  const openLogs = () => {
    void api.openLogDirectory().catch((error: unknown) => {
      toast.error(t("about.openLogsFailed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    });
  };

  useEffect(() => {
    let active = true;
    void api.aboutInfo().then((i) => {
      if (active) setInfo(i);
    });
    return () => {
      active = false;
    };
  }, []);

  // The section opts into selection as a whole: version strings get pasted into
  // bug reports, and the attributions below are notices we are obliged to
  // surface. The app has no Edit menu or context menu to copy them any other way.
  return (
    <section className="flex select-text flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3">
      {/* App identity + version */}
      <div className="flex flex-col">
        <span className="text-sm font-semibold text-bright-fg">
          {t("settings.about")}
        </span>
        <span className="text-xs text-muted">
          {info
            ? t("about.version", {
                name: t("app.name"),
                version: info.version,
              })
            : t("app.name")}
        </span>
        {info && (
          <span className="text-xs text-muted">
            Electron {info.electron} / Chromium {info.chrome} / Node {info.node}
          </span>
        )}
      </div>

      {/* App license */}
      <p className="text-xs text-muted">
        {t("about.appLicense", { name: t("app.name") })}
      </p>

      {/* The portable log location is part of the support contract: every
          scan/tool failure keeps its complete details in this directory. */}
      <section className="flex items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-bright-fg">
            {t("about.logs")}
          </span>
          <span className="text-xs text-muted">{t("about.logsDesc")}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={openLogs}
        >
          <FolderOpen className="size-4" />
          {t("about.openLogs")}
        </Button>
      </section>

      {/* Third-party licenses */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <span className="text-sm font-semibold text-bright-fg">
          {t("about.ossTitle")}
        </span>
        <p className="text-xs text-muted">{t("about.ossDesc")}</p>
        <p className="text-xs text-muted">{t("about.ffmpegNotice")}</p>
        <ul className="flex flex-col gap-1.5">
          {THIRD_PARTY.map((entry) => (
            <li
              key={entry.name}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-bg px-3 py-2"
            >
              <span className="truncate text-xs text-fg">{entry.name}</span>
              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted">
                {entry.license}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
