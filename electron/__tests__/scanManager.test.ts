import { beforeEach, describe, expect, it, vi } from "vitest";

const runScan = vi.hoisted(() => vi.fn());
const processPendingAssetTasks = vi.hoisted(() => vi.fn());
const recoverRunningAssetTasksSafely = vi.hoisted(() => vi.fn());
vi.mock("../core/jobs.js", () => ({ runScan }));
vi.mock("../core/assetService.js", () => ({
  processPendingAssetTasks,
  recoverRunningAssetTasksSafely,
}));
vi.mock("../core/queries.js", () => ({ clearExcludedFiles: vi.fn() }));
vi.mock("../core/logger.js", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { ScanManager } from "../scanManager.js";

type Deps = ConstructorParameters<typeof ScanManager>[0];

function fakeCore(id: string) {
  return { id, core: { db: {}, rootId: 1, root: `/${id}` } };
}

/**
 * A runScan that stays pending until aborted, or until the returned `finish`
 * completes every scan started so far. Each call gets its own settle, so
 * several concurrent scans (the All view) resolve independently.
 */
function pendingScan() {
  const finishers: (() => void)[] = [];
  runScan.mockImplementation(
    (
      _core: unknown,
      jobId: string,
      report: (e: unknown) => void,
      opts: { signal: AbortSignal },
    ) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = (aborted: boolean) => {
          if (settled) return;
          settled = true;
          report({ type: "done", jobId, stats: {}, aborted });
          resolve();
        };
        finishers.push(() => settle(false));
        opts.signal.addEventListener("abort", () => settle(true));
      }),
  );
  return () => finishers.forEach((f) => f());
}

function makeDeps(
  overrides: Partial<Deps> = {},
): Deps & { invalidateCaches: ReturnType<typeof vi.fn> } {
  const a = fakeCore("a");
  const invalidateCaches = vi.fn().mockResolvedValue(undefined);
  return {
    invalidateCaches,
    ws: {
      isAll: () => false,
      allCores: () => [a],
      active: () => a.core,
      activeId: "a",
    } as unknown as Deps["ws"],
    queryClient: { invalidateCaches } as unknown as Deps["queryClient"],
    emit: vi.fn(),
    isQuitting: () => false,
    logPath: () => "D:/PortableVideoLibrary/Data/logs/main.log",
    ...overrides,
  };
}

describe("ScanManager", () => {
  beforeEach(() => {
    runScan.mockReset();
    processPendingAssetTasks.mockReset();
    recoverRunningAssetTasksSafely.mockReset();
    processPendingAssetTasks.mockResolvedValue({ completed: 0, failed: 0 });
  });

  it("does not start a second scan of a workspace already being scanned", async () => {
    const finish = pendingScan();
    const scans = new ScanManager(makeDeps());
    expect(scans.start()).toMatch(/^job-/);
    expect(scans.start()).toBe("");
    expect(runScan).toHaveBeenCalledTimes(1);
    finish();
    await scans.abort("a");
    // Settled: the same workspace can be scanned again.
    pendingScan();
    expect(scans.start()).not.toBe("");
  });

  it("starts nothing once the app is quitting", () => {
    const scans = new ScanManager(makeDeps({ isQuitting: () => true }));
    expect(scans.start()).toBe("");
    expect(runScan).not.toHaveBeenCalled();
  });

  it("abort() resolves once the aborted scan has settled and caches are cleared", async () => {
    pendingScan();
    const deps = makeDeps();
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({ aborted: true }),
    );
    expect(deps.invalidateCaches).toHaveBeenCalledTimes(1);
  });

  it("in the All view scans every workspace and returns the first job id", async () => {
    pendingScan();
    const deps = makeDeps({
      ws: {
        isAll: () => true,
        allCores: () => [fakeCore("a"), fakeCore("b")],
        active: () => null,
        activeId: "all",
      } as unknown as Deps["ws"],
    });
    const scans = new ScanManager(deps);
    expect(scans.start()).toBe("job-1");
    expect(runScan).toHaveBeenCalledTimes(2);
    await scans.abortAll();
  });

  it("reports a failed scan as scan:done with an error flag and frees the workspace", async () => {
    runScan.mockRejectedValue(new Error("boom"));
    const deps = makeDeps();
    const scans = new ScanManager(deps);
    scans.start();
    await scans.abort("a");
    expect(deps.emit).toHaveBeenCalledWith(
      "scan:done",
      expect.objectContaining({
        error: true,
        errorMessage: "boom",
        logPath: "D:/PortableVideoLibrary/Data/logs/main.log",
      }),
    );
    pendingScan();
    expect(scans.start()).not.toBe("");
  });

  it("starts one bounded asset worker after a completed scan", async () => {
    runScan.mockImplementation(
      async (
        _core: unknown,
        jobId: string,
        report: (event: unknown) => void,
      ) => {
        report({ type: "done", jobId, stats: {}, aborted: false });
      },
    );
    const scans = new ScanManager(makeDeps());

    scans.start();
    await vi.waitFor(() => expect(processPendingAssetTasks).toHaveBeenCalled());

    expect(recoverRunningAssetTasksSafely).toHaveBeenCalledTimes(1);
    expect(processPendingAssetTasks).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: 1 }),
      { signal: expect.any(AbortSignal), limit: 8 },
    );
    await scans.abortAll();
  });

  it("waits for an existing asset worker instead of starting a second one", async () => {
    let releaseAssets!: () => void;
    processPendingAssetTasks.mockImplementation(
      (_core: unknown, options: { signal: AbortSignal }) =>
        new Promise<{ completed: number; failed: number }>((resolve) => {
          const finish = () => resolve({ completed: 0, failed: 0 });
          releaseAssets = finish;
          options.signal.addEventListener("abort", finish, { once: true });
        }),
    );
    runScan.mockImplementation(
      async (
        _core: unknown,
        jobId: string,
        report: (event: unknown) => void,
      ) => {
        report({ type: "done", jobId, stats: {}, aborted: false });
      },
    );
    const scans = new ScanManager(makeDeps());

    scans.start();
    await vi.waitFor(() => expect(processPendingAssetTasks).toHaveBeenCalled());
    expect(scans.start()).toMatch(/^job-/);
    expect(runScan).toHaveBeenCalledTimes(1);

    releaseAssets();
    await scans.abortAll();
  });

  it("recovers asset tasks when the background worker is aborted", async () => {
    processPendingAssetTasks.mockImplementation(
      (_core: unknown, options: { signal: AbortSignal }) =>
        new Promise<{ completed: number; failed: number }>((resolve) => {
          options.signal.addEventListener(
            "abort",
            () => resolve({ completed: 0, failed: 0 }),
            { once: true },
          );
        }),
    );
    runScan.mockImplementation(
      async (
        _core: unknown,
        jobId: string,
        report: (event: unknown) => void,
      ) => {
        report({ type: "done", jobId, stats: {}, aborted: false });
      },
    );
    const scans = new ScanManager(makeDeps());

    scans.start();
    await vi.waitFor(() => expect(processPendingAssetTasks).toHaveBeenCalled());
    await scans.abortAll();

    expect(recoverRunningAssetTasksSafely).toHaveBeenCalledTimes(2);
  });

  it("continues queued work after a wholly failed asset batch", async () => {
    processPendingAssetTasks
      .mockResolvedValueOnce({ completed: 0, failed: 1 })
      .mockResolvedValueOnce({ completed: 1, failed: 0 })
      .mockResolvedValueOnce({ completed: 0, failed: 0 });
    runScan.mockImplementation(
      async (
        _core: unknown,
        jobId: string,
        report: (event: unknown) => void,
      ) => {
        report({ type: "done", jobId, stats: {}, aborted: false });
      },
    );
    const scans = new ScanManager(makeDeps());

    scans.start();
    await vi.waitFor(() =>
      expect(processPendingAssetTasks).toHaveBeenCalledTimes(3),
    );
    await scans.abortAll();
  });
});
