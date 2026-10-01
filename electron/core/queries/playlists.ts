import { randomUUID } from "node:crypto";
import type { DB } from "../db.js";
import {
  FILE_COLS,
  FILE_FROM,
  attachTags,
  orderByFor,
} from "./files.js";
import {
  normalizePlaylistRule,
  playlistRuleSql,
  type PlaylistRule,
} from "../playlistRules.js";
import type { FileRow } from "../types.js";

export type PlaylistKind = "static" | "smart";

export interface PlaylistSort {
  field: "name" | "rating" | "captured" | "btime" | "accessed" | "hash";
  dir: "asc" | "desc";
}

export interface PlaylistRow {
  playlistId: string;
  kind: PlaylistKind;
  name: string;
  rule: PlaylistRule | null;
  sort: PlaylistSort | null;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistMediaEntry {
  id: number;
  videoId: string;
  path: string;
  title: string;
  duration: number | null;
  relPath: string;
}

interface PlaylistDbRow {
  playlistId: string;
  kind: PlaylistKind;
  name: string;
  ruleJson: string | null;
  sortJson: string | null;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

const PLAYLIST_SELECT =
  "SELECT p.playlist_id AS playlistId, p.kind, p.name, p.rule_json AS ruleJson, " +
  "p.sort_json AS sortJson, " +
  "(SELECT COUNT(*) FROM playlist_items pi WHERE pi.playlist_id = p.playlist_id) AS itemCount, " +
  "p.created_at AS createdAt, p.updated_at AS updatedAt FROM playlists p";

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeSort(sort: PlaylistSort | null | undefined): PlaylistSort | null {
  if (!sort) return null;
  const fields = new Set<PlaylistSort["field"]>([
    "name",
    "rating",
    "captured",
    "btime",
    "accessed",
    "hash",
  ]);
  if (!fields.has(sort.field) || (sort.dir !== "asc" && sort.dir !== "desc")) {
    throw new Error("invalid playlist sort");
  }
  return { field: sort.field, dir: sort.dir };
}

function mapPlaylist(row: PlaylistDbRow): PlaylistRow {
  return {
    playlistId: row.playlistId,
    kind: row.kind,
    name: row.name,
    rule: parseJson<PlaylistRule>(row.ruleJson),
    sort: parseJson<PlaylistSort>(row.sortJson),
    itemCount: Number(row.itemCount),
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

export function listPlaylists(db: DB): PlaylistRow[] {
  return (db.prepare(`${PLAYLIST_SELECT} ORDER BY p.updated_at DESC, p.playlist_id`).all() as PlaylistDbRow[]).map(mapPlaylist);
}

export function createPlaylist(
  db: DB,
  input: {
    name: string;
    kind: PlaylistKind;
    rule?: PlaylistRule;
    sort?: PlaylistSort | null;
    now?: number;
  },
): PlaylistRow {
  const name = input.name.trim();
  if (!name) throw new Error("playlist name is required");
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const rule = input.kind === "smart" ? normalizePlaylistRule(input.rule ?? { op: "tag", value: "" }) : null;
  if (input.kind === "smart" && !rule) throw new Error("smart playlist rule is required");
  if (input.kind === "static" && input.rule) throw new Error("static playlist cannot have a rule");
  const sort = normalizeSort(input.sort);
  const playlistId = randomUUID();
  db.prepare(
    "INSERT INTO playlists (playlist_id, kind, name, rule_json, sort_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(playlistId, input.kind, name, rule ? JSON.stringify(rule) : null, sort ? JSON.stringify(sort) : null, now, now);
  const row = db.prepare(`${PLAYLIST_SELECT} WHERE p.playlist_id = ?`).get(playlistId) as PlaylistDbRow | undefined;
  if (!row) throw new Error("playlist write did not produce a row");
  return mapPlaylist(row);
}

export function updatePlaylist(
  db: DB,
  playlistId: string,
  input: { name?: string; rule?: PlaylistRule; sort?: PlaylistSort | null; now?: number },
): PlaylistRow {
  const current = db.prepare("SELECT kind, rule_json AS ruleJson, sort_json AS sortJson FROM playlists WHERE playlist_id = ?").get(playlistId) as { kind: PlaylistKind; ruleJson: string | null; sortJson: string | null } | undefined;
  if (!current) throw new Error("playlist not found");
  const name = input.name?.trim() ?? undefined;
  if (name === "") throw new Error("playlist name is required");
  const rule = current.kind === "smart"
    ? normalizePlaylistRule(input.rule ?? parseJson<PlaylistRule>(current.ruleJson) ?? { op: "tag", value: "" })
    : null;
  if (current.kind === "static" && input.rule) throw new Error("static playlist cannot have a rule");
  const sort = input.sort === undefined ? parseJson<PlaylistSort>(current.sortJson) : normalizeSort(input.sort);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  db.prepare(
    "UPDATE playlists SET name = COALESCE(?, name), rule_json = ?, sort_json = ?, updated_at = ? WHERE playlist_id = ?",
  ).run(name ?? null, rule ? JSON.stringify(rule) : null, sort ? JSON.stringify(sort) : null, now, playlistId);
  const row = db.prepare(`${PLAYLIST_SELECT} WHERE p.playlist_id = ?`).get(playlistId) as PlaylistDbRow | undefined;
  if (!row) throw new Error("playlist disappeared during update");
  return mapPlaylist(row);
}

export function deletePlaylist(db: DB, playlistId: string): void {
  db.prepare("DELETE FROM playlists WHERE playlist_id = ?").run(playlistId);
}

export function videoIdForFile(db: DB, fileId: number): string | null {
  const row = db.prepare("SELECT video_id AS videoId FROM files WHERE id = ? AND deleted_at IS NULL").get(fileId) as { videoId: string | null } | undefined;
  return row?.videoId ?? null;
}

export function setPlaylistItems(
  db: DB,
  playlistId: string,
  videoIds: readonly string[],
  now = Math.floor(Date.now() / 1000),
): void {
  if (!db.prepare("SELECT 1 FROM playlists WHERE playlist_id = ?").get(playlistId)) {
    throw new Error("playlist not found");
  }
  const unique = [...new Set(videoIds)];
  const insert = db.prepare(
    "INSERT INTO playlist_items (playlist_id, video_id, position, added_at) SELECT ?, video_id, ?, ? FROM videos WHERE video_id = ?",
  );
  db.transaction(() => {
    db.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").run(playlistId);
    unique.forEach((videoId, position) => {
      insert.run(playlistId, position, now, videoId);
    });
    db.prepare("UPDATE playlists SET updated_at = ? WHERE playlist_id = ?").run(now, playlistId);
  })();
}

export function resolvePlaylistFiles(db: DB, playlistId: string): FileRow[] {
  const playlist = db.prepare("SELECT kind, rule_json AS ruleJson, sort_json AS sortJson FROM playlists WHERE playlist_id = ?").get(playlistId) as { kind: PlaylistKind; ruleJson: string | null; sortJson: string | null } | undefined;
  if (!playlist) throw new Error("playlist not found");
  const args: unknown[] = [];
  let sql = `SELECT ${FILE_COLS} ${FILE_FROM} WHERE f.deleted_at IS NULL`;
  if (playlist.kind === "static") {
    sql += " AND EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = ? AND pi.video_id = f.video_id)";
    args.push(playlistId);
  } else {
    const rule = parseJson<PlaylistRule>(playlist.ruleJson);
    if (!rule) throw new Error("playlist rule is invalid");
    sql += ` AND ${playlistRuleSql(rule, args)}`;
  }
  if (playlist.kind === "static") {
    sql += " ORDER BY (SELECT position FROM playlist_items pi WHERE pi.playlist_id = ? AND pi.video_id = f.video_id) ASC";
    args.push(playlistId);
  } else {
    const sort = parseJson<PlaylistSort>(playlist.sortJson);
    sql += ` ORDER BY ${sort ? orderByFor(sort.field, sort.dir) : "f.id ASC"}`;
  }
  const rows = db.prepare(sql).all(...args) as FileRow[];
  attachTags(db, rows);
  return rows;
}

export function resolvePlaylistMedia(db: DB, playlistId: string): PlaylistMediaEntry[] {
  const playlist = db.prepare("SELECT kind, rule_json AS ruleJson, sort_json AS sortJson FROM playlists WHERE playlist_id = ?").get(playlistId) as { kind: PlaylistKind; ruleJson: string | null; sortJson: string | null } | undefined;
  if (!playlist) throw new Error("playlist not found");
  const args: unknown[] = [];
  let sql = "SELECT f.id, f.video_id AS videoId, f.abs_path AS path, f.rel_path AS relPath, f.duration FROM files f LEFT JOIN file_meta m ON m.meta_key = f.meta_key WHERE f.deleted_at IS NULL";
  if (playlist.kind === "static") {
    sql += " AND EXISTS (SELECT 1 FROM playlist_items pi WHERE pi.playlist_id = ? AND pi.video_id = f.video_id)";
    args.push(playlistId);
  } else {
    const rule = parseJson<PlaylistRule>(playlist.ruleJson);
    if (!rule) throw new Error("playlist rule is invalid");
    sql += ` AND ${playlistRuleSql(rule, args)}`;
  }
  if (playlist.kind === "static") {
    sql += " ORDER BY (SELECT position FROM playlist_items pi WHERE pi.playlist_id = ? AND pi.video_id = f.video_id) ASC";
    args.push(playlistId);
  } else {
    const sort = parseJson<PlaylistSort>(playlist.sortJson);
    sql += ` ORDER BY ${sort ? orderByFor(sort.field, sort.dir) : "f.id ASC"}`;
  }
  return (db.prepare(sql).all(...args) as Array<Omit<PlaylistMediaEntry, "title"> & { relPath: string }>).map((row) => ({
    ...row,
    title: row.relPath,
  }));
}
