import {
  _electron,
  test as base,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitForIndexedMedia } from "./helpers";
import {
  electronLaunchOptions,
  mainScript,
} from "../../scripts/electron-launch.cjs";

export interface MeguriFixtures {
  app: ElectronApplication;
  window: Page;
  /** Same window after the fixture media appears in the list. */
  ready: Page;
  /** Root directory used as the library's indexed media source. */
  mediaRoot: string;
}

export const test = base.extend<MeguriFixtures>({
  mediaRoot: [path.join(process.cwd(), "e2e/fixtures/media"), { option: true }],
  app: async ({ mediaRoot }, use) => {
    if (!fs.existsSync(mainScript)) {
      throw new Error(
        "Built main script not found. Run `npm run build` before E2E tests.",
      );
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meguri-e2e-"));
    const portableRoot = path.join(userDataDir, "portable");
    const dataDir = path.join(portableRoot, "Data");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      path.join(dataDir, "config.json"),
      JSON.stringify({
        formatVersion: 2,
        workspaces: [],
        activeWorkspaceId: null,
        collections: [],
        workspaceEmojis: {},
        logo: "dark",
      }),
    );
    const app = await _electron.launch(
      electronLaunchOptions({
        args: [`--user-data-dir=${userDataDir}`],
        env: {
          MEGURI_DISABLE_TRAY: "1",
          MEGURI_ROOT: mediaRoot,
          MEGURI_PORTABLE_ROOT: portableRoot,
        },
      }),
    );

    try {
      await use(app);
    } finally {
      try {
        await app.close();
      } finally {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    }
  },
  window: async ({ app }, use) => {
    const page = await app.firstWindow();
    // E2E behavior assertions use the stable English catalog. The product
    // default remains Simplified Chinese when no language is persisted.
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => {
      localStorage.setItem("meguri.lang", "en");
    });
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },
  ready: async ({ window }, use) => {
    await waitForIndexedMedia(window);
    await use(window);
  },
});

export { expect } from "@playwright/test";
