// Regression tests for the per-root storage path derivation.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// paths.ts pulls the base dir from Electron's `app`; stub it for the test.
vi.mock("electron", () => ({ app: { getPath: () => "/base/userData" } }));

const { pathHash, dataDirForRoot, isInsideRoot, folderDirInsideRoot } =
  await import("../paths.js");

describe("pathHash", () => {
  it("is a deterministic 16-hex-char digest", () => {
    const h = pathHash("/media/movies");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(pathHash("/media/movies")).toBe(h);
  });

  it("differs for different paths", () => {
    expect(pathHash("/media/a")).not.toBe(pathHash("/media/b"));
  });
});

describe("dataDirForRoot", () => {
  it("places artifacts under <userData>/roots/<hash>", () => {
    expect(dataDirForRoot("/media/movies")).toBe(
      `/base/userData/roots/${pathHash("/media/movies")}`,
    );
  });
});

describe("isInsideRoot", () => {
  it("accepts paths inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const file = path.join(root, "a.mp4");
    fs.writeFileSync(file, "x");
    try {
      expect(isInsideRoot(file, root)).toBe(true);
      expect(isInsideRoot(root, root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects sibling prefixes and paths that normalize outside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-sib-"));
    const siblingFile = path.join(sibling, "a.mp4");
    fs.writeFileSync(siblingFile, "x");
    try {
      expect(isInsideRoot(siblingFile, root)).toBe(false);
      expect(isInsideRoot(path.join(root, "..", path.basename(sibling), "a.mp4"), root)).toBe(
        false,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("rejects symlinks whose target lies outside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-out-"));
    const target = path.join(outside, "secret.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "secret");
    fs.symlinkSync(target, link);
    try {
      expect(isInsideRoot(link, root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts symlinks whose target stays inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const target = path.join(root, "real.txt");
    const link = path.join(root, "link.txt");
    fs.writeFileSync(target, "ok");
    fs.symlinkSync(target, link);
    try {
      expect(isInsideRoot(link, root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns false when the path does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    try {
      expect(isInsideRoot(path.join(root, "missing.mp4"), root)).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("folderDirInsideRoot", () => {
  it("resolves a folder path to its directory, the root included", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    fs.mkdirSync(path.join(root, "Movie", "2024"), { recursive: true });
    try {
      // Canonical paths: the tmp dir itself may sit behind a symlink.
      const real = fs.realpathSync(root);
      expect(folderDirInsideRoot(root, "")).toBe(real);
      expect(folderDirInsideRoot(root, "Movie/2024")).toBe(
        path.join(real, "Movie", "2024"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses what is missing, not a directory, or leads outside", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-out-"));
    fs.writeFileSync(path.join(root, "a.mp4"), "x");
    fs.symlinkSync(outside, path.join(root, "escape"));
    try {
      expect(folderDirInsideRoot(root, "Gone")).toBeNull();
      expect(folderDirInsideRoot(root, "a.mp4")).toBeNull();
      expect(folderDirInsideRoot(root, "escape")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns the link's target for a link that stays inside", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"));
    try {
      expect(folderDirInsideRoot(root, "alias")).toBe(
        path.join(fs.realpathSync(root), "real"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses Windows separators and drive/stream colons in a segment", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-root-"));
    try {
      expect(folderDirInsideRoot(root, "a\\..\\b", "\\")).toBeNull();
      expect(folderDirInsideRoot(root, "C:", "\\")).toBeNull();
      expect(folderDirInsideRoot(root, "dir::$INDEX_ALLOCATION", "\\")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

