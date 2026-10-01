import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, RotateCcw } from "lucide-react";
import { api } from "@/ipc/client";
import { useI18n } from "@/i18n/I18nProvider";
import type { TranslationKey } from "@/i18n/locales/ja";
import type {
  RecoveryBackup,
  RecoveryStatus,
} from "@shared/ipc/schema";

interface RecoveryPageProps {
  initialStatus: RecoveryStatus;
  loading?: boolean;
}

const messageKeys: Record<
  Exclude<RecoveryStatus["state"], "ready">,
  TranslationKey
> = {
  "needs-initialization": "recovery.needsInitialization",
  "migration-failed": "recovery.migrationFailed",
  "restore-available": "recovery.restoreAvailable",
};

export function RecoveryPage({ initialStatus, loading = false }: RecoveryPageProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState(initialStatus);
  const [selectedBackup, setSelectedBackup] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backups = useQuery({
    queryKey: ["recovery_backups"],
    queryFn: api.recoveryListBackups,
    enabled: status.state === "restore-available",
    retry: false,
  });

  useEffect(() => {
    const first = backups.data?.[0]?.backupId;
    if (first && !selectedBackup) setSelectedBackup(first);
  }, [backups.data, selectedBackup]);

  const runAction = async () => {
    setBusy(true);
    setError(null);
    try {
      const next =
        status.state === "needs-initialization"
          ? await api.recoveryRetry(true)
          : status.state === "migration-failed"
            ? await api.recoveryRetry(false)
            : selectedBackup
              ? await api.recoveryRestore(selectedBackup)
              : null;
      if (next) setStatus(next);
      else setError(t("recovery.noBackups"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const primaryLabel =
    status.state === "needs-initialization"
      ? t("recovery.initialize")
      : status.state === "migration-failed"
        ? t("recovery.retry")
        : t("recovery.restore");
  const messageKey =
    status.state === "ready" ? "recovery.restart" : messageKeys[status.state];

  return (
    <main className="flex min-h-full items-center justify-center bg-canvas px-6 py-12 text-bright-fg">
      <section className="w-full max-w-2xl rounded-2xl border border-border bg-panel p-8 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-primary/15 p-3 text-primary">
            <AlertTriangle aria-hidden="true" size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{t("recovery.title")}</h1>
            <p className="mt-3 text-base text-muted-fg">
              {loading ? t("recovery.loading") : t(messageKey)}
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-canvas/40 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Database aria-hidden="true" size={16} />
            {t("recovery.dataDirectory")}
          </div>
          <code className="mt-2 block break-all text-sm text-muted-fg">
            {status.dataDir}
          </code>
        </div>

        {!loading && status.state === "restore-available" && (
          <div className="mt-6">
            <label className="text-sm font-medium" htmlFor="recovery-backup">
              {t("recovery.backup")}
            </label>
            <select
              id="recovery-backup"
              className="mt-2 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm"
              value={selectedBackup}
              onChange={(event) => setSelectedBackup(event.target.value)}
              disabled={busy}
            >
              {(backups.data ?? []).map((backup: RecoveryBackup) => (
                <option key={backup.backupId} value={backup.backupId}>
                  {new Date(backup.createdAt * 1000).toLocaleString()} ·{" "}
                  {backup.backupId}
                </option>
              ))}
            </select>
            {!backups.isLoading &&
              !backups.error &&
              (backups.data?.length ?? 0) === 0 && (
                <p className="mt-2 text-sm text-muted-fg">
                  {t("recovery.noBackups")}
                </p>
              )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-danger-fg">
            {error}
          </p>
        )}

        {!loading && (
          <button
            type="button"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void runAction()}
            disabled={
              busy ||
              (status.state === "restore-available" &&
                (!selectedBackup || (backups.data?.length ?? 0) === 0))
            }
          >
            <RotateCcw aria-hidden="true" size={16} />
            {busy ? t("recovery.loading") : primaryLabel}
          </button>
        )}
      </section>
    </main>
  );
}
