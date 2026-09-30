// Tests for Workspaces.addRoot(): registering a folder reports whether it was
// new, which the add-workspace channels turn into "added" vs "already added".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// workspaces.ts reads/writes <userData>/config.json via appConfig.ts; point that
// at a throwaway directory so each test gets a pristine config.
let userData = "";
vi.mock("electron", () => ({ app: { getPath: () => userData } }));

const { Workspaces } = await import("../workspaces.js");

let root = "";

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-addroot-"));
  root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-addroot-root-"));
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

describe("Workspaces.addRoot", () => {
  it("reports a folder registered for the first time as added", () => {
    const ws = new Workspaces();
    const first = ws.addRoot(root);
    expect(first).toEqual({ path: fs.realpathSync(root), added: true });
  });

  it("reports the same folder again as not added, with the stored path", () => {
    const ws = new Workspaces();
    const first = ws.addRoot(root);
    expect(ws.addRoot(root)).toEqual({ path: first.path, added: false });
    expect(ws.list().filter((w) => w.path === first.path)).toHaveLength(1);
  });

  it("keeps add() returning the stored path", () => {
    const ws = new Workspaces();
    const np = ws.add(root);
    expect(ws.add(root)).toBe(np);
  });
});
