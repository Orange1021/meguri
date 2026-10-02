import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stagingDir = path.join(repoRoot, ".portable-build");
const portableDir = path.join(repoRoot, "橙映");
const portableExecutable = path.join(portableDir, "橙映.exe");

function localBinary(name) {
  return path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? `${name}.cmd` : name,
  );
}

function run(binary, args) {
  execFileSync(binary, args, {
    cwd: repoRoot,
    env: process.env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

function ensurePortableDirectory() {
  fs.mkdirSync(portableDir, { recursive: true });
  fs.mkdirSync(path.join(portableDir, "Data"), { recursive: true });
  fs.mkdirSync(path.join(portableDir, "Media"), { recursive: true });

  const allowed = new Set(["Data", "Media", "橙映.exe"]);
  const unexpected = fs
    .readdirSync(portableDir)
    .filter((name) => !allowed.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Portable directory contains unexpected entries: ${unexpected.join(", ")}`,
    );
  }
}

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

try {
  run(localBinary("electron-vite"), ["build"]);
  run(localBinary("electron-builder"), [
    "--win",
    "portable",
    "--config.directories.output=.portable-build",
  ]);

  const artifacts = fs
    .readdirSync(stagingDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && path.extname(entry.name) === ".exe");
  if (artifacts.length !== 1) {
    throw new Error(
      `Expected one Windows portable executable, found ${artifacts.length}.`,
    );
  }

  ensurePortableDirectory();
  fs.copyFileSync(path.join(stagingDir, artifacts[0].name), portableExecutable);
  console.log(`Portable package ready: ${portableExecutable}`);
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
