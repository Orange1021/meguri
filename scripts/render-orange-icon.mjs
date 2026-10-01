import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "logo/orange-logo.svg");
const svg = await readFile(sourcePath, "utf8");
const squareOutputs = [
  ["logo/orange-1024.png", 1024],
  ["logo/appicon-1024.png", 1024],
  ["logo/app-512.png", 512],
  ["logo/app-256.png", 256],
  ["logo/app-128.png", 128],
  ["logo/app-64.png", 64],
  ["logo/app-32.png", 32],
  ["logo/tray-256.png", 256],
  ["logo/tray-64.png", 64],
  ["logo/tray-32.png", 32],
  ["logo/tray-16.png", 16],
  ["docs/assets/icon.png", 256],
  ["build/appx/Square150x150Logo.png", 150],
  ["build/appx/Square44x44Logo.png", 44],
  ["build/appx/StoreLogo.png", 50],
];

for (const [relativePath] of squareOutputs) {
  await mkdir(dirname(resolve(root, relativePath)), { recursive: true });
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.MEGURI_BROWSER_PATH
    ? { executablePath: process.env.MEGURI_BROWSER_PATH }
    : {}),
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [relativePath, size] of squareOutputs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg}</body>`,
    );
    const mark = page.locator("svg");
    await mark.evaluate((node, dimension) => {
      node.setAttribute("width", String(dimension));
      node.setAttribute("height", String(dimension));
    }, size);
    await mark.screenshot({
      path: resolve(root, relativePath),
      omitBackground: true,
    });
  }
  const widePath = resolve(root, "build/appx/Wide310x150Logo.png");
  await page.setViewportSize({ width: 310, height: 150 });
  await page.setContent(
    `<body style="margin:0;background:transparent"><div id="wide" style="width:310px;height:150px;display:flex;align-items:center;justify-content:center">${svg}</div></body>`,
  );
  const wideMark = page.locator("#wide svg");
  await wideMark.evaluate((node) => {
    node.setAttribute("width", "150");
    node.setAttribute("height", "150");
  });
  await page
    .locator("#wide")
    .screenshot({ path: widePath, omitBackground: true });
} finally {
  await browser.close();
}
