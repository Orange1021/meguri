// Scan orchestration: which workspaces are being scanned, how to abort them,
// and the renderer events a scan reports. main.ts owns one instance and hands
// it to the IPC layer; nothing else keeps scan state.
//
// Lives beside main.ts rather than under core/: it drives core's pipeline
// (jobs.ts) but also knows the renderer event channels, which core does not.
import type { Core } from "./core/index.js";
import {
  processPendingAssetTasks,
  recoverRunningAssetTasksSafely,
} from "./core/assetService.js";
import { runScan } from "./core/jobs.js";
import log from "./core/logger.js";
import * as q from "./core/queries.js";
import { emptyScanStats } from "./core/scan.js";
import type { QueryWorkerClient } from "./core/queryWorkerClient.js";
import type { Workspaces } from "./core/workspaces.js";

export interface ScanOptions {
  includeExcluded?: boolean;
  rebuild?: boolean;
}

interface AssetWorkerRun {
  completed: number;
  failed: number;
}

export interface AssetWorkerDeps {
  recoverRunningAssetTasks: (
    db: Core["db"],
    now?: number,
  ) => number | PromiseLike<number>;
  processPendingAssetTasks: (
    core: Core,
    options: { signal?: AbortSignal; limit?: number },
  ) => Promise<AssetWorkerRun>;
}

export interface ScanManagerDeps {
  ws: Workspaces;
  queryClient: QueryWorkerClient;
  /** Send an event to the renderer (no-op when the window is gone). */
  emit: (channel: string, payload: unknown) => void;
  /** Once the app is quitting no new scan may start. */
  isQuitting: () => boolean;
  /** The resolved portable log file shown when a scan fails. */
  logPath: () => string;
  /** Injectable asset worker functions for the manager's lifecycle tests. */
  assetWorker?: AssetWorkerDeps;
}

const MAX_SCAN_ERROR_MESSAGE = 2_048;
const ASSET_BATCH_LIMIT = 8;

function scanErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error);
  return (message.trim() || "Unknown scan error").slice(
    0,
    MAX_SCAN_ERROR_MESSAGE,
  );
}

export class ScanManager {
  // Workspace IDs with a scan in progress. To avoid chunk-tx contention,
  // concurrent scans of the same workspace are suppressed.
  private readonly scanning = new Set<string>();
  // AbortControllers for in-progress scans, keyed by workspace ID.
  private readonly controllers = new Map<string, AbortController>();
  // Completion promises for in-progress scans, keyed by workspace ID.
  private readonly promises = new Map<string, Promise<void>>();
  // One background asset worker per workspace. Asset work must not keep the
  // scan promise in the running state or block a second scan indefinitely.
  private readonly assetControllers = new Map<string, AbortController>();
  private readonly assetPromises = new Map<string, Promise<void>>();
  private readonly assetWorker: AssetWorkerDeps;
  private seq = 1;

  constructor(private readonly deps: ScanManagerDeps) {
    this.assetWorker = deps.assetWorker ?? {
      recoverRunningAssetTasks: recoverRunningAssetTasksSafely,
      processPendingAssetTasks,
    };
  }

  /**
   * Scan the active workspace, or — in the virtual "All" view — every
   * registered workspace concurrently (each gets its own job/progress).
   * Returns the first job's id for tracking ("" when nothing started).
   */
  start(opts: ScanOptions = {}): string {
    const { ws } = this.deps;
    if (ws.isAll()) {
      let first = "";
      for (const { id, core } of ws.allCores()) {
        const jobId = this.scanCore(core, id, opts);
        if (jobId && !first) first = jobId;
      }
      return first;
    }
    const core = ws.active();
    if (!core) return "";
    return this.scanCore(core, ws.activeId, opts);
  }

  /** Abort one workspace's scan and wait for it to settle. */
  async abort(wsId: string): Promise<void> {
    this.controllers.get(wsId)?.abort();
    this.assetControllers.get(wsId)?.abort();
    await Promise.all(
      [this.promises.get(wsId), this.assetPromises.get(wsId)].filter(
        (promise): promise is Promise<void> => promise != null,
      ),
    );
  }

  /** Abort every running scan. Resolves once they have all settled. */
  abortAll(): Promise<unknown> {
    for (const ctrl of this.controllers.values()) ctrl.abort();
    for (const ctrl of this.assetControllers.values()) ctrl.abort();
    return Promise.allSettled([
      ...this.promises.values(),
      ...this.assetPromises.values(),
    ]);
  }

  /** Start a scan for a single workspace's Core. Returns the job id (empty if already scanning). */
  private scanCore(core: Core, wsId: string | null, opts: ScanOptions): string {
    const { emit, queryClient } = this.deps;
    if (this.deps.isQuitting()) return ""; // shutdown has aborted scans; don't start new ones
    if (wsId && this.scanning.has(wsId)) return ""; // don't start again if already running
    const jobId = `job-${this.seq++}`;
    if (wsId) this.scanning.add(wsId);
    const controller = new AbortController();
    if (wsId) this.controllers.set(wsId, controller);
    const promise = (async () => {
      try {
        // Do not let an older asset worker touch the same workspace while the
        // filesystem index is being reconciled. It will be restarted after the
        // scan has published its completed state.
        const previousAssetWorker = this.stopAssetWorker(core, wsId);
        if (previousAssetWorker) await previousAssetWorker;
        if (opts.includeExcluded) q.clearExcludedFiles(core.db, core.rootId);
        await runScan(
          core,
          jobId,
          (e) => {
            if (e.type === "progress")
              emit("scan:progress", {
                jobId: e.jobId,
                phase: e.phase,
                done: e.done,
                total: e.total,
              });
            else if (e.type === "thumbDone")
              emit("thumb:done", { id: e.id, workspaceId: wsId });
            else if (e.type === "done")
              emit("scan:done", {
                jobId: e.jobId,
                stats: e.stats,
                aborted: e.aborted,
              });
          },
          { rebuild: opts.rebuild, signal: controller.signal },
        );
        if (!controller.signal.aborted) this.startAssetWorker(core, wsId);
      } catch (err) {
        log.error("scan failed", err);
        emit("scan:done", {
          jobId,
          stats: emptyScanStats(),
          error: true,
          errorMessage: scanErrorMessage(err),
          logPath: this.deps.logPath(),
        });
      } finally {
        if (wsId) {
          this.scanning.delete(wsId);
          this.controllers.delete(wsId);
          this.promises.delete(wsId);
        }
        // Scans can change duplicate group membership; clear derived query caches.
        // Runs after the bookkeeping above so a failure here can never leave the
        // workspace stuck in the "scanning" state.
        await queryClient.invalidateCaches();
      }
    })();
    if (wsId) this.promises.set(wsId, promise);
    void promise;
    return jobId;
  }

  private assetWorkerKey(core: Core, wsId: string | null): string {
    return wsId ?? core.root;
  }

  private startAssetWorker(core: Core, wsId: string | null): void {
    const key = this.assetWorkerKey(core, wsId);
    if (this.assetPromises.has(key)) return;

    const controller = new AbortController();
    const promise = this.runAssetWorker(core, controller.signal).finally(() => {
      if (this.assetPromises.get(key) === promise) {
        this.assetPromises.delete(key);
        this.assetControllers.delete(key);
      }
    });
    this.assetControllers.set(key, controller);
    this.assetPromises.set(key, promise);
    void promise;
  }

  private stopAssetWorker(
    core: Core,
    wsId: string | null,
  ): Promise<void> | undefined {
    const key = this.assetWorkerKey(core, wsId);
    const controller = this.assetControllers.get(key);
    const promise = this.assetPromises.get(key);
    if (!promise) return undefined;
    controller?.abort();
    return promise;
  }

  private async runAssetWorker(core: Core, signal: AbortSignal): Promise<void> {
    let interrupted = false;
    try {
      await this.assetWorker.recoverRunningAssetTasks(core.db);
      for (;;) {
        if (signal.aborted) break;
        const result = await this.assetWorker.processPendingAssetTasks(core, {
          signal,
          limit: ASSET_BATCH_LIMIT,
        });
        // Failed tasks have a retry backoff. Keep draining while this batch
        // claimed work: a wholly failed batch may still sit ahead of queued
        // tasks, and the failed rows will not be reclaimed immediately because
        // their backoff moves next_attempt_at into the future.
        if (result.completed === 0 && result.failed === 0) break;
        // Yield between batches so IPC and renderer work remain responsive when
        // sidecar copies or cached thumbnails complete immediately.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      interrupted = true;
      if (!signal.aborted) log.warn("asset worker failed", error);
    } finally {
      // The asset service deliberately leaves claimed rows alone when its
      // signal is aborted. Requeue them here so an interrupted worker cannot
      // strand work in the invisible `running` state.
      if (signal.aborted || interrupted)
        await this.assetWorker.recoverRunningAssetTasks(core.db);
    }
  }
}
