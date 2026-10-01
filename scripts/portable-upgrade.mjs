import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PORTABLE_MANIFEST_NAME = "portable-manifest.json";
export const PORTABLE_SWAP_STATE_NAME = ".portable-app-swap.json";
export const PORTABLE_MANIFEST_VERSION = 1;
export const PORTABLE_DATA_LAYOUT_VERSION = 1;
export const PORTABLE_CONFIG_FORMAT_VERSION = 2;

const GENERATED_DIRECTORY_PATTERN =
  /^\.portable-(?:previous|rollback)-[0-9a-f-]+$/i;

/**
 * @typedef {object} PortableAppManifest
 * @property {number} formatVersion
 * @property {string} appVersion
 * @property {string} executable
 * @property {number} minDataLayoutVersion
 * @property {number} maxDataLayoutVersion
 * @property {number} minConfigFormatVersion
 * @property {number} maxConfigFormatVersion
 * @property {"backup-before-migrate"} migrationPolicy
 */

export class PortableUpgradeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {unknown} [cause]
   */
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PortableUpgradeError";
    this.code = code;
  }
}

/**
 * Resolve the filesystem slots used by the portable release workflow.
 * The root is always supplied explicitly; this helper never guesses a drive
 * or falls back to the current working directory.
 *
 * @param {string} rootDir
 */
export function layoutForRoot(rootDir) {
  const root = path.resolve(rootDir);
  return {
    rootDir: root,
    activeAppDir: path.join(root, "App"),
    stagedAppDir: path.join(root, "App.new"),
    previousAppDir: path.join(root, "App.previous"),
    swapStatePath: path.join(root, PORTABLE_SWAP_STATE_NAME),
    dataDir: path.join(root, "Data"),
  };
}

/**
 * Atomically promote App.new to App and preserve the previous application in
 * App.previous. Data is never renamed, copied, or removed by this operation.
 *
 * @param {string} rootDir
 */
export function activateStagedApp(rootDir) {
  const layout = layoutForRoot(rootDir);
  ensureRoot(layout);
  recoverPortableAppSwap(rootDir);

  const manifest = validateStagedApp(layout);
  validateDataCompatibility(layout, manifest);

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const retiredPreviousName = `.portable-previous-${id}`;
  const retiredPreviousPath = path.join(layout.rootDir, retiredPreviousName);
  const state = {
    formatVersion: 1,
    operation: "activate",
    phase: "prepared",
    id,
    retiredPreviousName,
  };
  writeSwapState(layout.swapStatePath, state);

  let previousRetired = false;
  let activeMoved = false;
  let candidateMoved = false;
  try {
    if (isPresent(layout.previousAppDir)) {
      moveDirectory(layout.previousAppDir, retiredPreviousPath);
      previousRetired = true;
      state.phase = "previous-moved";
      writeSwapState(layout.swapStatePath, state);
    }

    if (isPresent(layout.activeAppDir)) {
      moveDirectory(layout.activeAppDir, layout.previousAppDir);
      activeMoved = true;
      state.phase = "active-moved";
      writeSwapState(layout.swapStatePath, state);
    }

    moveDirectory(layout.stagedAppDir, layout.activeAppDir);
    candidateMoved = true;
    state.phase = "candidate-moved";
    writeSwapState(layout.swapStatePath, state);

    removeGeneratedDirectory(retiredPreviousPath, layout.rootDir);
    removeSwapState(layout.swapStatePath);
    return {
      operation: "activate",
      appVersion: manifest.appVersion,
      dataChanged: false,
    };
  } catch (error) {
    try {
      restoreActivationAfterFailure({
        layout,
        retiredPreviousPath,
        previousRetired,
        activeMoved,
        candidateMoved,
      });
      removeSwapState(layout.swapStatePath);
    } catch (recoveryError) {
      throw new PortableUpgradeError(
        "swap-recovery-required",
        "portable App activation failed and requires recovery",
        recoveryError,
      );
    }
    throw new PortableUpgradeError(
      "activation-failed",
      "portable App activation failed",
      error,
    );
  }
}

/**
 * Swap App and App.previous. This is the operator-controlled rollback path;
 * App.new is left untouched so a failed candidate can be inspected or
 * retried. Data remains outside the swap transaction.
 *
 * @param {string} rootDir
 */
export function rollbackPortableApp(rootDir) {
  const layout = layoutForRoot(rootDir);
  ensureRoot(layout);
  recoverPortableAppSwap(rootDir);
  assertDirectory(layout.activeAppDir, "active App");
  assertDirectory(layout.previousAppDir, "previous App");

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const temporaryCurrentName = `.portable-rollback-${id}`;
  const temporaryCurrentPath = path.join(layout.rootDir, temporaryCurrentName);
  const state = {
    formatVersion: 1,
    operation: "rollback",
    phase: "prepared",
    id,
    temporaryCurrentName,
  };
  writeSwapState(layout.swapStatePath, state);

  try {
    moveDirectory(layout.activeAppDir, temporaryCurrentPath);
    state.phase = "active-moved";
    writeSwapState(layout.swapStatePath, state);

    moveDirectory(layout.previousAppDir, layout.activeAppDir);
    state.phase = "candidate-moved";
    writeSwapState(layout.swapStatePath, state);

    moveDirectory(temporaryCurrentPath, layout.previousAppDir);
    state.phase = "previous-moved";
    writeSwapState(layout.swapStatePath, state);

    removeSwapState(layout.swapStatePath);
    return {
      operation: "rollback",
      appVersion:
        readManifestIfPresent(layout.activeAppDir)?.appVersion ?? null,
      dataChanged: false,
    };
  } catch (error) {
    try {
      restoreRollbackAfterFailure(layout, temporaryCurrentPath);
      removeSwapState(layout.swapStatePath);
    } catch (recoveryError) {
      throw new PortableUpgradeError(
        "swap-recovery-required",
        "portable App rollback failed and requires recovery",
        recoveryError,
      );
    }
    throw new PortableUpgradeError(
      "rollback-failed",
      "portable App rollback failed",
      error,
    );
  }
}

/**
 * Recover a swap left by a process termination. Activation commits when the
 * candidate has reached App and App.new no longer exists; otherwise it is
 * rolled back. Rollback completes when its temporary current App is present.
 *
 * @param {string} rootDir
 */
export function recoverPortableAppSwap(rootDir) {
  const layout = layoutForRoot(rootDir);
  if (!fs.existsSync(layout.swapStatePath)) return { recovered: false };
  ensureRoot(layout);
  const state = readSwapState(layout.swapStatePath);

  if (state.operation === "activate") {
    recoverActivation(layout, state);
  } else {
    recoverRollback(layout, state);
  }
  return { recovered: true, operation: state.operation };
}

/**
 * @param {{ rootDir: string, dataDir: string }} layout
 */
function ensureRoot(layout) {
  if (!fs.existsSync(layout.rootDir)) {
    throw new PortableUpgradeError(
      "root-not-found",
      `portable root does not exist: ${layout.rootDir}`,
    );
  }
  const stat = fs.lstatSync(layout.rootDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PortableUpgradeError(
      "invalid-root",
      `portable root is not a real directory: ${layout.rootDir}`,
    );
  }
}

/**
 * @param {ReturnType<typeof layoutForRoot>} layout
 */
function validateStagedApp(layout) {
  const manifest = readManifest(layout.stagedAppDir);
  const executablePath = safeChildPath(
    layout.stagedAppDir,
    manifest.executable,
    "manifest executable",
  );
  assertFile(executablePath, "manifest executable");
  if (
    !fs.existsSync(path.join(layout.stagedAppDir, "resources", "app.asar")) &&
    !fs.existsSync(path.join(layout.stagedAppDir, "package.json"))
  ) {
    throw new PortableUpgradeError(
      "invalid-app",
      "staged App is missing resources/app.asar or package.json",
    );
  }
  return manifest;
}

/**
 * The swap service validates the portable config boundary. SQLite schema
 * compatibility is deliberately left to the application's checksummed
 * migration runner, which creates a backup before writing and exposes restore
 * if migration fails.
 *
 * @param {ReturnType<typeof layoutForRoot>} layout
 * @param {PortableAppManifest} manifest
 */
function validateDataCompatibility(layout, manifest) {
  if (
    manifest.minDataLayoutVersion > PORTABLE_DATA_LAYOUT_VERSION ||
    manifest.maxDataLayoutVersion < PORTABLE_DATA_LAYOUT_VERSION
  ) {
    throw new PortableUpgradeError(
      "data-incompatible",
      "staged App does not support the portable Data layout",
    );
  }
  if (!fs.existsSync(layout.dataDir)) return;
  const dataStat = fs.lstatSync(layout.dataDir);
  if (!dataStat.isDirectory() || dataStat.isSymbolicLink()) {
    throw new PortableUpgradeError(
      "data-incompatible",
      "portable Data must be a real directory",
    );
  }

  const configPath = path.join(layout.dataDir, "config.json");
  if (!fs.existsSync(configPath)) return;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new PortableUpgradeError(
      "data-incompatible",
      "portable Data config cannot be parsed",
      error,
    );
  }
  const formatVersion = config?.formatVersion;
  if (
    !Number.isSafeInteger(formatVersion) ||
    formatVersion < manifest.minConfigFormatVersion ||
    formatVersion > manifest.maxConfigFormatVersion
  ) {
    throw new PortableUpgradeError(
      "data-incompatible",
      `portable Data config format ${String(formatVersion)} is outside the staged App compatibility range`,
    );
  }
}

/**
 * @param {string} appDir
 * @returns {PortableAppManifest}
 */
function readManifest(appDir) {
  assertDirectory(appDir, "staged App");
  const manifestPath = path.join(appDir, PORTABLE_MANIFEST_NAME);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      `portable App manifest cannot be read: ${manifestPath}`,
      error,
    );
  }
  validateManifest(value, manifestPath);
  return value;
}

/**
 * @param {string} appDir
 * @returns {PortableAppManifest | null}
 */
function readManifestIfPresent(appDir) {
  const manifestPath = path.join(appDir, PORTABLE_MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return null;
  return readManifest(appDir);
}

/**
 * @param {unknown} value
 * @param {string} manifestPath
 */
function validateManifest(value, manifestPath) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      `portable App manifest must be an object: ${manifestPath}`,
    );
  }
  const manifest = /** @type {Record<string, unknown>} */ (value);
  if (manifest.formatVersion !== PORTABLE_MANIFEST_VERSION) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      `unsupported portable App manifest version: ${String(manifest.formatVersion)}`,
    );
  }
  for (const field of ["appVersion", "executable", "migrationPolicy"]) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
      throw new PortableUpgradeError(
        "invalid-manifest",
        `portable App manifest field is invalid: ${field}`,
      );
    }
  }
  for (const field of [
    "minDataLayoutVersion",
    "maxDataLayoutVersion",
    "minConfigFormatVersion",
    "maxConfigFormatVersion",
  ]) {
    if (!Number.isSafeInteger(manifest[field])) {
      throw new PortableUpgradeError(
        "invalid-manifest",
        `portable App manifest field is invalid: ${field}`,
      );
    }
  }
  if (
    manifest.migrationPolicy !== "backup-before-migrate" ||
    manifest.minDataLayoutVersion > manifest.maxDataLayoutVersion ||
    manifest.minConfigFormatVersion > manifest.maxConfigFormatVersion
  ) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      "portable App manifest compatibility range is invalid",
    );
  }
  safeChildPath(path.dirname(manifestPath), manifest.executable, "executable");
}

/**
 * @param {string} filePath
 * @param {unknown} value
 */
function writeSwapState(filePath, value) {
  const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temporaryPath, "wx");
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporaryPath, filePath);
}

/**
 * @param {string} filePath
 */
function removeSwapState(filePath) {
  fs.rmSync(filePath, { force: true });
}

/**
 * @param {string} filePath
 */
function readSwapState(filePath) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new PortableUpgradeError(
      "invalid-swap-state",
      `portable App swap state cannot be read: ${filePath}`,
      error,
    );
  }
  if (
    value === null ||
    typeof value !== "object" ||
    value.formatVersion !== 1 ||
    (value.operation !== "activate" && value.operation !== "rollback")
  ) {
    throw new PortableUpgradeError(
      "invalid-swap-state",
      "portable App swap state is invalid",
    );
  }
  return value;
}

/**
 * @param {ReturnType<typeof layoutForRoot>} layout
 * @param {Record<string, unknown>} state
 */
function recoverActivation(layout, state) {
  const retiredPreviousPath = path.join(
    layout.rootDir,
    String(state.retiredPreviousName ?? ""),
  );
  assertGeneratedPath(retiredPreviousPath, layout.rootDir);
  const activePresent = isPresent(layout.activeAppDir);
  const stagedPresent = isPresent(layout.stagedAppDir);
  if (activePresent && !stagedPresent) {
    removeGeneratedDirectory(retiredPreviousPath, layout.rootDir);
    removeSwapState(layout.swapStatePath);
    return;
  }

  if (activePresent && stagedPresent) {
    if (isPresent(retiredPreviousPath) && !isPresent(layout.previousAppDir)) {
      moveDirectory(retiredPreviousPath, layout.previousAppDir);
    }
    removeSwapState(layout.swapStatePath);
    return;
  }

  if (!activePresent && stagedPresent && isPresent(layout.previousAppDir)) {
    moveDirectory(layout.previousAppDir, layout.activeAppDir);
  }
  if (!isPresent(layout.previousAppDir) && isPresent(retiredPreviousPath)) {
    moveDirectory(retiredPreviousPath, layout.previousAppDir);
  }
  removeSwapState(layout.swapStatePath);
}

/**
 * @param {ReturnType<typeof layoutForRoot>} layout
 * @param {Record<string, unknown>} state
 */
function recoverRollback(layout, state) {
  const temporaryCurrentPath = path.join(
    layout.rootDir,
    String(state.temporaryCurrentName ?? ""),
  );
  assertGeneratedPath(temporaryCurrentPath, layout.rootDir);
  const activePresent = isPresent(layout.activeAppDir);
  const previousPresent = isPresent(layout.previousAppDir);
  const temporaryPresent = isPresent(temporaryCurrentPath);

  if (temporaryPresent && activePresent && !previousPresent) {
    moveDirectory(temporaryCurrentPath, layout.previousAppDir);
  } else if (temporaryPresent && !activePresent && previousPresent) {
    moveDirectory(layout.previousAppDir, layout.activeAppDir);
    moveDirectory(temporaryCurrentPath, layout.previousAppDir);
  } else if (!temporaryPresent && activePresent && previousPresent) {
    // The final rename completed and only marker cleanup was interrupted.
  } else {
    throw new PortableUpgradeError(
      "swap-recovery-required",
      "portable App rollback state is incomplete",
    );
  }
  removeSwapState(layout.swapStatePath);
}

/**
 * @param {ReturnType<typeof layoutForRoot>} layout
 * @param {string} retiredPreviousPath
 * @param {boolean} previousRetired
 * @param {boolean} activeMoved
 * @param {boolean} candidateMoved
 */
function restoreActivationAfterFailure({
  layout,
  retiredPreviousPath,
  previousRetired,
  activeMoved,
  candidateMoved,
}) {
  if (candidateMoved && isPresent(layout.activeAppDir)) {
    moveDirectory(layout.activeAppDir, layout.stagedAppDir);
  }
  if (activeMoved && isPresent(layout.previousAppDir)) {
    moveDirectory(layout.previousAppDir, layout.activeAppDir);
  }
  if (previousRetired && isPresent(retiredPreviousPath)) {
    moveDirectory(retiredPreviousPath, layout.previousAppDir);
  }
}

/**
 * @param {ReturnType<typeof layoutForRoot>} layout
 * @param {string} temporaryCurrentPath
 */
function restoreRollbackAfterFailure(layout, temporaryCurrentPath) {
  if (!isPresent(temporaryCurrentPath)) return;
  if (isPresent(layout.activeAppDir) && !isPresent(layout.previousAppDir)) {
    moveDirectory(layout.activeAppDir, layout.previousAppDir);
    moveDirectory(temporaryCurrentPath, layout.activeAppDir);
    return;
  }
  if (!isPresent(layout.activeAppDir) && isPresent(layout.previousAppDir)) {
    moveDirectory(temporaryCurrentPath, layout.activeAppDir);
  }
}

/**
 * @param {string} source
 * @param {string} destination
 */
function moveDirectory(source, destination) {
  assertDirectory(source, "source App slot");
  if (isPresent(destination)) {
    throw new PortableUpgradeError(
      "slot-not-empty",
      `portable App destination is not empty: ${destination}`,
    );
  }
  fs.renameSync(source, destination);
}

/**
 * @param {string} directory
 * @param {string} rootDir
 */
function removeGeneratedDirectory(directory, rootDir) {
  if (!isPresent(directory)) return;
  assertGeneratedPath(directory, rootDir);
  fs.rmSync(directory, { recursive: true, force: true });
}

/**
 * @param {string} candidate
 * @param {string} rootDir
 */
function assertGeneratedPath(candidate, rootDir) {
  const relative = path.relative(rootDir, candidate);
  const base = path.basename(candidate);
  if (
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative) ||
    !GENERATED_DIRECTORY_PATTERN.test(base)
  ) {
    throw new PortableUpgradeError(
      "unsafe-swap-state",
      `portable App swap path is unsafe: ${candidate}`,
    );
  }
}

/**
 * @param {string} filePath
 * @param {string} label
 */
function assertFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new PortableUpgradeError(
      "invalid-app",
      `${label} is missing: ${filePath}`,
      error,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PortableUpgradeError(
      "invalid-app",
      `${label} is not a regular file: ${filePath}`,
    );
  }
}

/**
 * @param {string} directory
 * @param {string} label
 */
function assertDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    throw new PortableUpgradeError(
      "invalid-app",
      `${label} is missing: ${directory}`,
      error,
    );
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new PortableUpgradeError(
      "invalid-app",
      `${label} is not a regular directory: ${directory}`,
    );
  }
}

/**
 * @param {string} directory
 */
function isPresent(directory) {
  return fs.existsSync(directory);
}

/**
 * @param {string} baseDirectory
 * @param {string} relativePath
 * @param {string} label
 */
function safeChildPath(baseDirectory, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath)
  ) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      `${label} must be a relative path`,
    );
  }
  const candidate = path.resolve(baseDirectory, relativePath);
  const relative = path.relative(path.resolve(baseDirectory), candidate);
  if (
    relative === ".." ||
    relative.startsWith(".." + path.sep) ||
    path.isAbsolute(relative)
  ) {
    throw new PortableUpgradeError(
      "invalid-manifest",
      `${label} escapes the App directory`,
    );
  }
  return candidate;
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  try {
    const { command, rootDir } = parseArguments(process.argv.slice(2));
    const result =
      command === "activate"
        ? activateStagedApp(rootDir)
        : command === "rollback"
          ? rollbackPortableApp(rootDir)
          : recoverPortableAppSwap(rootDir);
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (error) {
    const code = error instanceof PortableUpgradeError ? error.code : "failed";
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[portable-upgrade:${code}] ${message}\n`);
    process.exitCode = 1;
  }
}

function parseArguments(args) {
  const rootIndex = args.indexOf("--root");
  const rootDir = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  if (typeof rootDir !== "string" || rootDir.length === 0) {
    throw new PortableUpgradeError(
      "invalid-arguments",
      "usage: node scripts/portable-upgrade.mjs --root <PortableVideoLibrary> --activate|--rollback|--recover",
    );
  }
  const command = args.includes("--activate")
    ? "activate"
    : args.includes("--rollback")
      ? "rollback"
      : args.includes("--recover")
        ? "recover"
        : null;
  if (!command) {
    throw new PortableUpgradeError(
      "invalid-arguments",
      "one of --activate, --rollback, or --recover is required",
    );
  }
  return { command, rootDir };
}
