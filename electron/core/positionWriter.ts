// Coalesces playback-position writes before they reach SQLite.
//
// The renderer already throttles what it sends (every few seconds while
// playing), but several players can report at once — the detail view, the
// playlist, the audio bar — and better-sqlite3 runs on the main thread, so every
// write is time the UI and IPC wait on. Routine reports are held briefly and
// only the latest per file is written; a report marked urgent (pause, seek,
// close, end) is written straight away together with anything still held, so a
// read that follows it — reopening the file, the list's progress bars — sees it.

/** How long a routine report may wait for a newer one to replace it. */
export const POSITION_COALESCE_MS = 2_000;

export class PositionWriter {
  private readonly pending = new Map<string, () => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly onError: (e: unknown) => void,
    private readonly delayMs = POSITION_COALESCE_MS,
  ) {}

  /**
   * Queue `write` under `key`, replacing whatever was held for that key. The
   * write runs later, so it should resolve its database when it runs: the
   * workspace may be gone by then, which surfaces as an error to `onError`.
   */
  queue(key: string, write: () => void, urgent = false): void {
    // Re-inserted rather than overwritten so the map's order stays the order
    // the latest reports arrived in.
    this.pending.delete(key);
    this.pending.set(key, write);
    if (urgent) {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }

  /** Write everything held now (also used on quit, before the DBs close). */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const writes = [...this.pending.values()];
    this.pending.clear();
    for (const write of writes) {
      try {
        write();
      } catch (e) {
        this.onError(e);
      }
    }
  }

  /** Number of writes held (for tests). */
  get size(): number {
    return this.pending.size;
  }
}
