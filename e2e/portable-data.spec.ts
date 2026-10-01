import { _electron, expect, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  electronLaunchOptions,
  mainScript,
} from "../scripts/electron-launch.cjs";

test.describe("Portable data recovery", () => {
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
