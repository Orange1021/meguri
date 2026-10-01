import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { newDb, insertFile } from "./helpers.js";
import type { DB } from "../db.js";
import { addManualTag } from "../tags.js";
import {
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  resolvePlaylistFiles,
  setPlaylistItems,
  updatePlaylist,
} from "../queries/playlists.js";

describe("persistent playlists", () => {
  let db: DB;
  afterEach(() => db?.close());

  it("stores static order by stable video identity and skips missing files", () => {
    ({ db } = newDb());
    const first = insertFile(db, 1, { relPath: "first.mp4" });
    const second = insertFile(db, 1, { relPath: "second.mp4" });
    const firstVideo = bindIdentity(db, first);
    const secondVideo = bindIdentity(db, second);
    const playlist = createPlaylist(db, { name: "Ordered", kind: "static" });
    setPlaylistItems(db, playlist.playlistId, [secondVideo, firstVideo]);
    db.prepare("UPDATE files SET deleted_at = 10 WHERE id = ?").run(second);
    expect(resolvePlaylistFiles(db, playlist.playlistId).map((row) => row.relPath)).toEqual([
      "first.mp4",
    ]);
  });

  it("evaluates a smart playlist against current tags and updates it", () => {
    ({ db } = newDb());
    const tagged = insertFile(db, 1, { relPath: "tagged.mp4" });
    const other = insertFile(db, 1, { relPath: "other.mp4" });
    bindIdentity(db, tagged);
    bindIdentity(db, other);
    addManualTag(db, tagged, "series:柯南");
    const playlist = createPlaylist(db, {
      name: "Conan",
      kind: "smart",
      rule: { op: "tag", value: "series:柯南" },
    });
    expect(resolvePlaylistFiles(db, playlist.playlistId).map((row) => row.id)).toEqual([
      tagged,
    ]);
    updatePlaylist(db, playlist.playlistId, {
      name: "Other",
      rule: { op: "tag", value: "missing" },
    });
    expect(resolvePlaylistFiles(db, playlist.playlistId)).toEqual([]);
    expect(other).toBeGreaterThan(tagged);
    expect(listPlaylists(db)[0].name).toBe("Other");
    deletePlaylist(db, playlist.playlistId);
    expect(listPlaylists(db)).toEqual([]);
  });
});

function bindIdentity(db: DB, fileId: number): string {
  const videoId = randomUUID();
  db.prepare(
    "INSERT INTO videos (video_id, kind, status, created_at, updated_at, last_seen_at) SELECT ?, kind, 'active', 1, 1, 1 FROM files WHERE id = ?",
  ).run(videoId, fileId);
  db.prepare("UPDATE files SET video_id = ? WHERE id = ?").run(videoId, fileId);
  return videoId;
}
