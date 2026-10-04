import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import {
  ASSET_GENERATION_VERSIONS,
  type AssetCandidate,
  type AssetKind,
  type AssetSource,
  type AssetStatus,
  choosePreferredAsset,
} from "../assets.js";

export interface AssetRow extends AssetCandidate {
  errorCode: string | null;
  createdAt: number;
}

export interface AssetTaskRow {
  taskId: string;
  videoId: string;
  kind: Exclude<AssetKind, "manual-original">;
  source: Exclude<AssetSource, "manual">;
  generationVersion: string;
  status: "queued" | "running" | "completed" | "failed";
  attempts: number;
  nextAttemptAt: number;
  errorCode: string | null;
}

const ASSET_SELECT =
  "SELECT asset_id AS assetId, video_id AS videoId, kind, source, path, " +
  "generation_version AS generationVersion, status, error_code AS errorCode, " +
  "created_at AS createdAt, updated_at AS updatedAt FROM assets";

function asAssetKind(value: string): AssetKind {
  if (value === "cover" || value === "sheet" || value === "manual-original") {
    return value;
  }
  throw new Error(`unknown asset kind: ${value}`);
}

function asAssetSource(value: string): AssetSource {
  if (
    value === "manual" ||
    value === "embedded" ||
    value === "sidecar" ||
    value === "auto"
  ) {
    return value;
  }
  throw new Error(`unknown asset source: ${value}`);
}

function mapAsset(row: Record<string, unknown>): AssetRow {
  return {
    assetId: String(row.assetId),
    videoId: String(row.videoId),
    kind: asAssetKind(String(row.kind)),
    source: asAssetSource(String(row.source)),
    path: String(row.path),
    generationVersion: String(row.generationVersion),
    status: row.status as AssetStatus,
    errorCode: (row.errorCode as string | null) ?? null,
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function listAssets(
  db: DB,
  videoId: string,
  kind?: AssetKind,
): AssetRow[] {
  const rows = (
    kind
      ? db
          .prepare(
            `${ASSET_SELECT} WHERE video_id = ? AND kind = ? ORDER BY updated_at DESC`,
          )
          .all(videoId, kind)
      : db
          .prepare(
            `${ASSET_SELECT} WHERE video_id = ? ORDER BY kind, updated_at DESC`,
          )
          .all(videoId)
  ) as Array<Record<string, unknown>>;
  return rows.map(mapAsset);
}

export function preferredAsset(
  db: DB,
  videoId: string,
  kind: AssetKind,
): AssetRow | null {
  const assets = listAssets(db, videoId, kind);
  const selected = choosePreferredAsset(assets);
  return selected
    ? (assets.find((asset) => asset.assetId === selected.assetId) ?? null)
    : null;
}

export function hasReadyManualCover(db: DB, videoId: string): boolean {
  return (
    db
      .prepare(
        "SELECT 1 FROM assets WHERE video_id = ? AND kind = 'cover' AND source = 'manual' AND status = 'ready' LIMIT 1",
      )
      .get(videoId) != null
  );
}

export function upsertAsset(
  db: DB,
  input: {
    assetId?: string;
    videoId: string;
    kind: AssetKind;
    source: AssetSource;
    path: string;
    generationVersion?: string;
    status?: AssetStatus;
    errorCode?: string | null;
    now: number;
  },
): AssetRow {
  const assetId = input.assetId ?? randomUUID();
  const generationVersion =
    input.generationVersion ?? ASSET_GENERATION_VERSIONS[input.kind];
  db.prepare(
    `INSERT INTO assets
      (asset_id, video_id, kind, source, path, generation_version, status, error_code, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id, kind, source) DO UPDATE SET
       path = excluded.path,
       generation_version = excluded.generation_version,
       status = excluded.status,
       error_code = excluded.error_code,
       updated_at = excluded.updated_at`,
  ).run(
    assetId,
    input.videoId,
    input.kind,
    input.source,
    input.path,
    generationVersion,
    input.status ?? "ready",
    input.errorCode ?? null,
    input.now,
    input.now,
  );
  const row = db
    .prepare(`${ASSET_SELECT} WHERE video_id = ? AND kind = ? AND source = ?`)
    .get(input.videoId, input.kind, input.source) as
    Record<string, unknown> | undefined;
  if (!row) throw new Error("asset write did not produce a row");
  return mapAsset(row);
}

export function retireAsset(
  db: DB,
  videoId: string,
  kind: AssetKind,
  source: AssetSource,
  now: number,
): void {
  db.prepare(
    "UPDATE assets SET status = 'retired', updated_at = ?, error_code = NULL WHERE video_id = ? AND kind = ? AND source = ?",
  ).run(now, videoId, kind, source);
}

export function enqueueAssetTask(
  db: DB,
  input: {
    videoId: string;
    kind: Exclude<AssetKind, "manual-original">;
    source: Exclude<AssetSource, "manual">;
    generationVersion?: string;
    now: number;
  },
): void {
  const generationVersion =
    input.generationVersion ?? ASSET_GENERATION_VERSIONS[input.kind];
  db.prepare(
    `INSERT INTO asset_tasks
      (task_id, video_id, kind, source, generation_version, status, attempts, next_attempt_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
     ON CONFLICT(video_id, kind, source, generation_version) DO UPDATE SET
       status = CASE
         WHEN asset_tasks.status = 'running' THEN asset_tasks.status
         ELSE excluded.status
       END,
       next_attempt_at = CASE
         WHEN asset_tasks.status = 'running' THEN asset_tasks.next_attempt_at
         ELSE excluded.next_attempt_at
       END,
       error_code = CASE
         WHEN asset_tasks.status = 'running' THEN asset_tasks.error_code
         ELSE NULL
       END,
       updated_at = CASE
         WHEN asset_tasks.status = 'running' THEN asset_tasks.updated_at
         ELSE excluded.updated_at
       END`,
  ).run(
    randomUUID(),
    input.videoId,
    input.kind,
    input.source,
    generationVersion,
    input.now,
    input.now,
    input.now,
  );
}

export function claimAssetTasks(
  db: DB,
  now: number,
  limit: number,
): AssetTaskRow[] {
  const capped = Math.max(1, Math.min(32, Math.floor(limit)));
  const rows = db
    .prepare(
      `SELECT task_id AS taskId, video_id AS videoId, kind, source,
              generation_version AS generationVersion, status, attempts,
              next_attempt_at AS nextAttemptAt, error_code AS errorCode
         FROM asset_tasks
        WHERE status IN ('queued', 'failed') AND next_attempt_at <= ?
        ORDER BY next_attempt_at, created_at
        LIMIT ?`,
    )
    .all(now, capped) as AssetTaskRow[];
  if (rows.length === 0) return [];
  return claimTaskRows(db, rows, now);
}

export function claimAutomaticCoverTaskForVideo(
  db: DB,
  videoId: string,
  now: number,
): AssetTaskRow | null {
  const row = db
    .prepare(
      `SELECT task_id AS taskId, video_id AS videoId, kind, source,
              generation_version AS generationVersion, status, attempts,
              next_attempt_at AS nextAttemptAt, error_code AS errorCode
         FROM asset_tasks
        WHERE video_id = ? AND kind = 'cover' AND source = 'auto'
          AND status IN ('queued', 'failed') AND next_attempt_at <= ?
        ORDER BY next_attempt_at, created_at
        LIMIT 1`,
    )
    .get(videoId, now) as AssetTaskRow | undefined;
  if (!row) return null;
  return claimTaskRows(db, [row], now)[0] ?? null;
}

function claimTaskRows(
  db: DB,
  rows: AssetTaskRow[],
  now: number,
): AssetTaskRow[] {
  const mark = db.prepare(
    "UPDATE asset_tasks SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE task_id = ? AND status IN ('queued','failed')",
  );
  const claimed: AssetTaskRow[] = [];
  db.transaction(() => {
    for (const row of rows) {
      const result = mark.run(now, row.taskId);
      if (result.changes > 0)
        claimed.push({ ...row, status: "running", attempts: row.attempts + 1 });
    }
  })();
  return claimed;
}

/** Requeue work left in `running` when the owning worker was interrupted. */
export function recoverRunningAssetTasks(db: DB, now: number): number {
  return db
    .prepare(
      "UPDATE asset_tasks SET status = 'queued', next_attempt_at = ?, updated_at = ?, error_code = NULL WHERE status = 'running'",
    )
    .run(now, now).changes;
}

export function completeAssetTask(db: DB, taskId: string, now: number): void {
  db.prepare(
    "UPDATE asset_tasks SET status = 'completed', updated_at = ?, error_code = NULL WHERE task_id = ? AND status = 'running'",
  ).run(now, taskId);
}

export function failAssetTask(
  db: DB,
  taskId: string,
  now: number,
  errorCode: string,
  attempts: number,
): void {
  const backoff = Math.min(3600, 2 ** Math.min(Math.max(attempts, 1), 10));
  db.prepare(
    "UPDATE asset_tasks SET status = 'failed', next_attempt_at = ?, updated_at = ?, error_code = ? WHERE task_id = ? AND status = 'running'",
  ).run(now + backoff, now, errorCode.slice(0, 200), taskId);
}
