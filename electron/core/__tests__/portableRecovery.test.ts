import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  layoutForRoot,
  type PortableLayout,
} from "../portablePaths.js";
import {
  importLegacyUserData,
  locatorForResolvedRoot,
  type LegacyImportOptions,
} from "../portableRecovery.js";
import { loadConfig, normalizeDir } from "../appConfig.js";
import { pathHash } from "../paths.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function createLegacyUserDataFixture(input: {
  root: string;
  config: Record<string, unknown>;
}): {
  layout: PortableLayout;
  legacyConfigPath: string;
  dataDir: string;
  options: LegacyImportOptions;
} {
  const packageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-portable-root-"),
  );
  const legacyUserDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "meguri-legacy-"),
  );
  directories.push(packageRoot, legacyUserDataDir);
  const layout = layoutForRoot(packageRoot);
  fs.mkdirSync(path.join(layout.mediaDir, "柯南"), { recursive: true });
  const legacyConfigPath = path.join(legacyUserDataDir, "config.json");
  fs.writeFileSync(legacyConfigPath, JSON.stringify(input.config));

  const legacyRootData = path.join(
    legacyUserDataDir,
    "roots",
    pathHash(normalizeDir(input.root)),
  );
  fs.mkdirSync(path.join(legacyRootData, "thumbs"), { recursive: true });
  fs.writeFileSync(path.join(legacyRootData, "thumbs", "cover.webp"), "cover");
  const db = new Database(path.join(legacyRootData, "db.sqlite"));
  db.exec("CREATE TABLE marker (value TEXT NOT NULL)");
  db.prepare("INSERT INTO marker (value) VALUES (?)").run("legacy");
  db.close();

  return {
    layout,
    legacyConfigPath,
    dataDir: layout.dataDir,
    options: {
      layout,
      legacyUserDataDir,
      legacyConfigPath,
      now: () => 1_700_000_000,
    },
  };
}

describe("portable recovery", () => {
  it("imports legacy userData into Data without deleting the source", async () => {
    const fixture = createLegacyUserDataFixture({
      root: "E:/Media/柯南",
      config: { roots: ["E:/Media/柯南"] },
    });
    const result = await importLegacyUserData(fixture.options);

    expect(result.status).toBe("migrated");
    expect(fs.existsSync(fixture.legacyConfigPath)).toBe(true);
    expect(fs.existsSync(path.join(fixture.dataDir, "config.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(
        path.join(
          fixture.dataDir,
          "roots",
          pathHash(normalizeDir("E:/Media/柯南")),
          "thumbs",
          "cover.webp",
        ),
      ),
    ).toBe(true);
    expect(loadConfig(fixture.layout).roots).toEqual([
      path.resolve("E:/Media/柯南"),
    ]);
  });

  it("stores a root below Media as a portable-relative locator", () => {
    const layout = layoutForRoot("E:/PortableVideoLibrary");
    const record = locatorForResolvedRoot(
      layout,
      "E:/PortableVideoLibrary/Media/柯南",
    );

    expect(record).toEqual({ kind: "portable-relative", value: "柯南" });
  });

  it("keeps an external root explicitly non-portable", () => {
    const layout = layoutForRoot("E:/PortableVideoLibrary");
    const record = locatorForResolvedRoot(layout, "C:/Videos/other");

    expect(record).toEqual({
      kind: "absolute",
      value: path.resolve("C:/Videos/other"),
    });
  });

  it("reruns an interrupted import idempotently", async () => {
    const fixture = createLegacyUserDataFixture({
      root: "E:/Media/柯南",
      config: { roots: ["E:/Media/柯南"] },
    });

    await importLegacyUserData(fixture.options);
    const second = await importLegacyUserData(fixture.options);

    expect(second.status).toBe("already-current");
  });
});
