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
  preparePortableData,
  retryPortableData,
  type LegacyImportOptions,
} from "../portableRecovery.js";
import {
  configureConfigStorage,
  loadConfig,
  normalizeDir,
} from "../appConfig.js";
import { pathHash } from "../paths.js";
import { Workspaces } from "../workspaces.js";

const directories: string[] = [];

afterEach(() => {
  configureConfigStorage(undefined);
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
  it("reports needs-initialization when no portable or legacy data exists", async () => {
    const packageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-empty-root-"),
    );
    const legacyUserDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-empty-legacy-"),
    );
    directories.push(packageRoot, legacyUserDataDir);
    const layout = layoutForRoot(packageRoot);

    const status = await preparePortableData(layout, {
      legacyUserDataDir,
      appVersion: "0.8.0",
    });

    expect(status.state).toBe("needs-initialization");
    expect(status.dataDir).toBe(layout.dataDir);
  });

  it("only becomes ready after explicit initialization", async () => {
    const packageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-init-root-"),
    );
    const legacyUserDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-init-legacy-"),
    );
    directories.push(packageRoot, legacyUserDataDir);
    const layout = layoutForRoot(packageRoot);

    const status = await retryPortableData(layout, {
      legacyUserDataDir,
      initialize: true,
      appVersion: "0.8.0",
    });

    expect(status.state).toBe("ready");
    expect(fs.existsSync(layout.configPath)).toBe(true);
  });

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

  it("keeps the persisted workspace database id when a portable root moves", () => {
    const packageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-stable-workspace-"),
    );
    directories.push(packageRoot);
    const layout = layoutForRoot(packageRoot);
    const mediaRoot = path.join(layout.mediaDir, "柯南");
    const workspaceId = "stable-workspace-id";
    fs.mkdirSync(mediaRoot, { recursive: true });
    fs.mkdirSync(layout.dataDir, { recursive: true });
    fs.writeFileSync(
      layout.configPath,
      JSON.stringify({
        formatVersion: 2,
        workspaces: [
          {
            workspaceId,
            name: "柯南",
            locator: { kind: "portable-relative", value: "柯南" },
            legacyPathHash: "legacy-path-hash",
            createdAt: 1_700_000_000,
          },
        ],
        activeWorkspaceId: workspaceId,
        collections: [],
        workspaceEmojis: {},
        logo: "enso",
      }),
    );
    configureConfigStorage(layout);

    const workspaces = new Workspaces({ layout });
    const core = workspaces.byId(workspaceId);

    expect(core?.dataDir).toBe(path.join(layout.dataDir, "roots", workspaceId));
    expect(loadConfig(layout).logo).toBe("orange");
    workspaces.closeAll();
  });
});
