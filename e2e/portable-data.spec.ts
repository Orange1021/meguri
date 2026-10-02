import { _electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  electronLaunchOptions,
  mainScript,
} from "../scripts/electron-launch.cjs";

test.describe("Portable data recovery", () => {
  test("verifies the built app boundary and App-only replacement workflow", () => {
    const repoRoot = path.resolve(process.cwd());
    expect(fs.existsSync(mainScript)).toBe(true);
    expect(
      fs.existsSync(path.join(repoRoot, "out", "renderer", "index.html")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(repoRoot, "out", "main", "queryWorker.js")),
    ).toBe(true);

    const unpackedApp = path.join(repoRoot, "release", "win-unpacked");
    if (fs.existsSync(unpackedApp)) {
      expect(fs.existsSync(path.join(unpackedApp, "OrangeView.exe"))).toBe(
        true,
      );
      expect(
        fs.existsSync(path.join(unpackedApp, "resources", "app.asar")),
      ).toBe(true);
    }

    const portableRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-portable-upgrade-e2e-"),
    );
    const dataDir = path.join(portableRoot, "Data");
    const activeApp = path.join(portableRoot, "App");
    const stagedApp = path.join(portableRoot, "App.new");
    const previousApp = path.join(portableRoot, "App.previous");
    const upgradeScript = path.join(
      repoRoot,
      "scripts",
      "portable-upgrade.mjs",
    );

    const hashData = () => {
      const hash = createHash("sha256");
      const visit = (directory: string, relative = ""): void => {
        for (const entry of fs
          .readdirSync(directory, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))) {
          const entryPath = path.join(directory, entry.name);
          const entryRelative = path.join(relative, entry.name);
          hash.update(entryRelative + "\0");
          if (entry.isDirectory()) visit(entryPath, entryRelative);
          else hash.update(fs.readFileSync(entryPath));
        }
      };
      visit(dataDir);
      return hash.digest("hex");
    };

    const createAppSlot = (directory: string, version: string): void => {
      fs.mkdirSync(path.join(directory, "resources"), { recursive: true });
      fs.writeFileSync(path.join(directory, "OrangeView.exe"), version);
      fs.writeFileSync(path.join(directory, "resources", "app.asar"), version);
      fs.writeFileSync(
        path.join(directory, "portable-manifest.json"),
        JSON.stringify({
          formatVersion: 1,
          appVersion: version,
          executable: "OrangeView.exe",
          minDataLayoutVersion: 1,
          maxDataLayoutVersion: 1,
          minConfigFormatVersion: 2,
          maxConfigFormatVersion: 2,
          migrationPolicy: "backup-before-migrate",
        }),
      );
    };

    try {
      createAppSlot(activeApp, "old");
      createAppSlot(stagedApp, "new");
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(
        path.join(dataDir, "config.json"),
        JSON.stringify({ formatVersion: 2, workspaces: [] }),
      );
      const dataHashBefore = hashData();

      execFileSync(
        process.env.npm_node_execpath ?? process.execPath,
        [upgradeScript, "--root", portableRoot, "--activate"],
        { cwd: repoRoot, stdio: "pipe" },
      );
      expect(
        fs.readFileSync(path.join(activeApp, "OrangeView.exe"), "utf8"),
      ).toBe("new");
      expect(
        fs.readFileSync(path.join(previousApp, "OrangeView.exe"), "utf8"),
      ).toBe("old");
      expect(hashData()).toBe(dataHashBefore);

      execFileSync(
        process.env.npm_node_execpath ?? process.execPath,
        [upgradeScript, "--root", portableRoot, "--rollback"],
        { cwd: repoRoot, stdio: "pipe" },
      );
      expect(
        fs.readFileSync(path.join(activeApp, "OrangeView.exe"), "utf8"),
      ).toBe("old");
      expect(
        fs.readFileSync(path.join(previousApp, "OrangeView.exe"), "utf8"),
      ).toBe("new");
      expect(hashData()).toBe(dataHashBefore);
    } finally {
      fs.rmSync(portableRoot, { recursive: true, force: true });
    }
  });

  test("shows initialization when Data is missing and keeps userData free of databases", async () => {
    const portableRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-portable-e2e-"),
    );
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "meguri-userdata-e2e-"),
    );
    const app = await _electron.launch(
      electronLaunchOptions({
        args: ["--user-data-dir=" + userDataDir],
        env: {
          MEGURI_DISABLE_TRAY: "1",
          MEGURI_PORTABLE_ROOT: portableRoot,
        },
      }),
    );

    try {
      const page = await app.firstWindow();
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByRole("heading", { name: "便携数据恢复" }),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.lang)).toBe(
        "zh-CN",
      );
      await page.evaluate(() => {
        window.localStorage.setItem("meguri.lang", "en");
      });
      await page.reload();
      await page.waitForLoadState("domcontentloaded");
      await expect(
        page.getByRole("heading", { name: "Portable data recovery" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Initialize and start" }),
      ).toBeVisible();
      expect(fs.existsSync(path.join(userDataDir, "roots"))).toBe(false);
      expect(
        fs.existsSync(path.join(portableRoot, "Data", "config.json")),
      ).toBe(false);
    } finally {
      await app.close();
      fs.rmSync(portableRoot, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
