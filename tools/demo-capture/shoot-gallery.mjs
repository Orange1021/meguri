// Capture the README gallery screenshots (docs/assets/*.png):
// the list view mode plus a few theme variations of the grid.
import path from "node:path";
import {
  assetsDir,
  launchApp,
  resolveMediaRoot,
  screenshotTo,
  setTheme,
  sleep,
  waitReady,
} from "./lib.mjs";

const THEMES = ["gruvbox-dark", "nord-dark", "solarized-light"];

const { page, close } = await launchApp({ mediaRoot: resolveMediaRoot() });

try {
  await waitReady(page);

  for (const theme of THEMES) {
    await setTheme(page, theme);
    await screenshotTo(page, path.join(assetsDir, `theme-${theme}.png`));
  }

  await setTheme(page, THEMES[0]);
  await page.getByRole("button", { name: "List view" }).click();
  await sleep(800);
  await screenshotTo(page, path.join(assetsDir, "view-list.png"));
} finally {
  await close();
}
