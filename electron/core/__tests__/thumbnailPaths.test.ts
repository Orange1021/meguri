import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Core } from "../index.js";
import { clearNonVideoThumbnailPaths } from "../thumbnailPaths.js";

const roots: string[] = [];
const dataDirs: string[] = [];
const openCores: Core[] = [];

afterEach(async () => {
  for (const core of openCores.splice(0)) core.close();
  for (const root of roots.splice(0))
    await fsp.rm(root, { recursive: true, force: true });
  for (const dataDir of dataDirs.splice(0))
    await fsp.rm(dataDir, { recursive: true, force: true });
});

async function setup() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "meguri-thumb-root-"));
  const dataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "meguri-thumb-data-"),
  );
  roots.push(root);
  dataDirs.push(dataDir);
  await fsp.writeFile(path.join(root, "clip.mp4"), "media");
  const core = Core.init(root, { dataDir });
  openCores.push(core);
  return { root, dataDir, core };
}

async function insertThumbRow(core: Core, thumbPath: string): Promise<number> {
  const result = core.db
    .prepare(
      `INSERT INTO files
        (root_id, rel_path, abs_path, kind, thumb_path, thumb_status, created_at)
       VALUES (?, ?, ?, 'video', ?, 'done', 0)`,
    )
    .run(core.rootId, "clip.mp4", path.join(core.root, "clip.mp4"), thumbPath);
  return Number(result.lastInsertRowid);
}

describe("portable thumbnail paths", () => {
  it("rebases a moved thumbnail path to the current Data directory", async () => {
    const { core, dataDir } = await setup();
    const oldPath = path.join(
      core.dataDir,
      "old-release",
      "roots",
      "thumbs",
      "1.webp",
    );
    const id = await insertThumbRow(core, oldPath);
    const currentPath = path.join(core.thumbsDir(), `${id}.webp`);
    await fsp.writeFile(currentPath, "thumbnail");
    core.close();

    const reopened = Core.init(core.root, { dataDir });
    openCores.push(reopened);
    const row = reopened.db
      .prepare(
        "SELECT thumb_path AS thumbPath, thumb_status AS status FROM files WHERE id = ?",
      )
      .get(id) as { thumbPath: string | null; status: string };

    expect(row).toEqual({ thumbPath: currentPath, status: "done" });

    reopened.close();
    const reopenedAgain = Core.init(core.root, { dataDir });
    openCores.push(reopenedAgain);
    expect(
      reopenedAgain.db
        .prepare("SELECT thumb_path FROM files WHERE id = ?")
        .get(id),
    ).toEqual({ thumb_path: currentPath });
  });

  it("preserves a manual cover asset when an old generated thumbnail remains", async () => {
    const { core, dataDir } = await setup();
    const id = await insertThumbRow(
      core,
      path.join(core.dataDir, "assets", "video-id", "cover.jpg"),
    );
    const manualPath = path.join(
      core.dataDir,
      "assets",
      "video-id",
      "cover.jpg",
    );
    await fsp.mkdir(path.dirname(manualPath), { recursive: true });
    await fsp.writeFile(manualPath, "manual cover");
    const generatedPath = path.join(core.thumbsDir(), `${id}.webp`);
    await fsp.writeFile(generatedPath, "old automatic cover");
    core.close();

    const reopened = Core.init(core.root, { dataDir });
    openCores.push(reopened);

    expect(
      reopened.db
        .prepare("SELECT thumb_path AS thumbPath FROM files WHERE id = ?")
        .get(id),
    ).toEqual({ thumbPath: manualPath });
  });

  it("marks a thumbnail for regeneration when both paths are missing", async () => {
    const { core, dataDir } = await setup();
    const oldPath = path.join(core.dataDir, "old-release", "thumbs", "1.webp");
    const id = await insertThumbRow(core, oldPath);
    core.close();

    const reopened = Core.init(core.root, { dataDir });
    openCores.push(reopened);
    expect(
      reopened.db
        .prepare(
          "SELECT thumb_path AS thumbPath, thumb_status AS status FROM files WHERE id = ?",
        )
        .get(id),
    ).toEqual({ thumbPath: null, status: "pending" });
  });

  it("clears generated thumbnails for image rows without deleting the source", async () => {
    const { core, root } = await setup();
    const imagePath = path.join(root, "picture.jpg");
    await fsp.writeFile(imagePath, "image bytes");
    const thumbPath = path.join(core.thumbsDir(), "1.webp");
    const id = await insertThumbRow(core, thumbPath);
    core.db.prepare("UPDATE files SET kind = 'image' WHERE id = ?").run(id);
    await fsp.writeFile(thumbPath, "thumbnail");

    await clearNonVideoThumbnailPaths(core.db, core.thumbsDir());

    expect(
      core.db
        .prepare(
          "SELECT thumb_path AS thumbPath, thumb_status AS status FROM files WHERE id = ?",
        )
        .get(id),
    ).toEqual({ thumbPath: null, status: "done" });
    expect((await fsp.stat(imagePath)).isFile()).toBe(true);
    await expect(fsp.stat(thumbPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("clears a stale non-video path without deleting a file outside Data", async () => {
    const { core } = await setup();
    const outsideDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "meguri-old-thumb-"),
    );
    dataDirs.push(outsideDir);
    const oldPath = path.join(outsideDir, "1.webp");
    await fsp.writeFile(oldPath, "thumbnail");
    const id = await insertThumbRow(core, oldPath);
    core.db.prepare("UPDATE files SET kind = 'image' WHERE id = ?").run(id);

    await clearNonVideoThumbnailPaths(core.db, core.thumbsDir());

    expect(
      core.db
        .prepare(
          "SELECT thumb_path AS thumbPath, thumb_status AS status FROM files WHERE id = ?",
        )
        .get(id),
    ).toEqual({ thumbPath: null, status: "done" });
    expect((await fsp.stat(oldPath)).isFile()).toBe(true);
  });
});
