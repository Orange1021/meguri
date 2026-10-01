import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const bin = process.platform === "win32" ? "electron.cmd" : "electron";
const electron = path.join(process.cwd(), "node_modules", ".bin", bin);
const inherited = process.env.NODE_OPTIONS?.trim();
const nodeOptions = [inherited, "--experimental-require-module"]
  .filter(Boolean)
  .join(" ");

const result = spawnSync(
  electron,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_OPTIONS: nodeOptions,
    },
  },
);

if (result.error) {
  console.error(`Unable to start Electron test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
