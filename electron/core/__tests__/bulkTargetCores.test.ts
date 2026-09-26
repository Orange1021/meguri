// The IPC-layer helper every bulk channel resolves its targets through. What
// matters is what it promises the handlers: groups merged per workspace, and
// every Core resolved before a single write can happen.
import { describe, expect, it } from "vitest";
import { bulkTargetCores } from "../../ipc/helpers.js";
import type { Core } from "../index.js";
import type { Workspaces } from "../workspaces.js";

/** A Workspaces stand-in that only knows which ids exist. */
function fakeWorkspaces(known: string[]): Workspaces {
  const cores = new Map<string, Core>(
    known.map((id) => [id, { id } as unknown as Core]),
  );
  return {
    byId: (id: string) => cores.get(id) ?? null,
  } as unknown as Workspaces;
}

describe("bulkTargetCores", () => {
  it("returns one entry per workspace, with its Core", () => {
    const ws = fakeWorkspaces(["a", "b"]);
    const groups = bulkTargetCores(ws, [
      { workspaceId: "a", fileIds: [1, 2] },
      { workspaceId: "b", fileIds: [3] },
    ]);
    expect(groups.map((g) => [g.workspaceId, g.fileIds])).toEqual([
      ["a", [1, 2]],
      ["b", [3]],
    ]);
    expect(groups.every((g) => g.core)).toBe(true);
  });

  it("merges groups that repeat a workspace", () => {
    // A payload does not have to group the way the renderer does; merging keeps
    // it at one transaction and one set of statements per database.
    const groups = bulkTargetCores(fakeWorkspaces(["a"]), [
      { workspaceId: "a", fileIds: [1] },
      { workspaceId: "a", fileIds: [2, 3] },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].fileIds).toEqual([1, 2, 3]);
  });

  it("throws on an unknown workspace before returning anything", () => {
    // This is what keeps a handler from editing the workspaces ahead of a bad id
    // in the list: nothing is written because nothing is returned.
    expect(() =>
      bulkTargetCores(fakeWorkspaces(["a"]), [
        { workspaceId: "a", fileIds: [1] },
        { workspaceId: "gone", fileIds: [2] },
      ]),
    ).toThrow(/unknown workspace/);
  });

  it("does not mutate the caller's arrays", () => {
    const targets = [{ workspaceId: "a", fileIds: [1] }];
    const groups = bulkTargetCores(fakeWorkspaces(["a"]), targets);
    groups[0].fileIds.push(99);
    expect(targets[0].fileIds).toEqual([1]);
  });
});
