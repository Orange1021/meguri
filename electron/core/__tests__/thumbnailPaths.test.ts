import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Core } from "../index.js";

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
});
