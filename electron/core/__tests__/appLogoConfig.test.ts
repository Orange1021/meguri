import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { layoutForRoot, type PortableLayout } from "../portablePaths.js";
import {
  configureConfigStorage,
  loadConfig,
  saveConfig,
} from "../appConfig.js";

const directories: string[] = [];

afterEach(() => {
  configureConfigStorage(undefined);
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): PortableLayout {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-logo-"));
  directories.push(root);
  return layoutForRoot(root);
}

function writeConfig(layout: PortableLayout, logo: unknown): void {
  fs.mkdirSync(path.dirname(layout.configPath), { recursive: true });
  fs.writeFileSync(
    layout.configPath,
    JSON.stringify({
      formatVersion: 2,
      workspaces: [],
      activeWorkspaceId: null,
      collections: [],
      workspaceEmojis: {},
      update: { autoCheck: true, ignoredVersion: null, lastCheckAt: null },
      logo,
    }),
  );
}

describe("Logo config compatibility", () => {
  it("maps legacy values to orange and persists the normalized value", () => {
    const layout = fixture();
    writeConfig(layout, "enso");
    configureConfigStorage(layout);

    expect(loadConfig(layout).logo).toBe("orange");
    expect(JSON.parse(fs.readFileSync(layout.configPath, "utf8")).logo).toBe(
      "orange",
    );
  });

  it("uses orange when the config has no valid Logo value", () => {
    const layout = fixture();
    writeConfig(layout, "not-a-logo");
    configureConfigStorage(layout);

    expect(loadConfig(layout).logo).toBe("orange");
  });

  it("writes orange as the only new configuration value", () => {
    const layout = fixture();
    configureConfigStorage(layout);
    saveConfig(
      {
        formatVersion: 2,
        workspaces: [],
        activeWorkspaceId: null,
        roots: [],
        activePath: null,
        collections: [],
        workspaceEmojis: {},
        update: { autoCheck: true, ignoredVersion: null, lastCheckAt: null },
        logo: "orange",
      },
      layout,
    );

    expect(JSON.parse(fs.readFileSync(layout.configPath, "utf8")).logo).toBe(
      "orange",
    );
  });
});
