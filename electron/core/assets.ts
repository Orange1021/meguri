import path from "node:path";

export const ASSET_KINDS = ["cover", "sheet", "manual-original"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const ASSET_SOURCES = ["manual", "embedded", "sidecar", "auto"] as const;
export type AssetSource = (typeof ASSET_SOURCES)[number];

export const ASSET_STATUSES = [
  "queued",
  "generating",
  "ready",
  "failed",
  "retired",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_GENERATION_VERSIONS: Record<
  AssetKind extends "manual-original" ? never : Exclude<AssetKind, "manual-original">,
  string
> & { "manual-original": string } = {
  cover: "cover-v1",
  sheet: "sheet-v1",
  "manual-original": "manual-v1",
};

export const ASSET_SOURCE_PRIORITY: Record<AssetSource, number> = {
  manual: 4,
  embedded: 3,
  sidecar: 2,
  auto: 1,
};

export interface AssetCandidate {
  assetId: string;
  videoId: string;
  kind: AssetKind;
  source: AssetSource;
  path: string;
  generationVersion: string;
  status: AssetStatus;
  updatedAt: number;
}

/** Return the currently visible asset, honoring the user-over-derived policy. */
export function choosePreferredAsset(
  candidates: readonly AssetCandidate[],
): AssetCandidate | null {
  const ready = candidates.filter((candidate) => candidate.status === "ready");
  if (ready.length === 0) return null;
  return [...ready].sort((left, right) => {
    const priority =
      ASSET_SOURCE_PRIORITY[right.source] - ASSET_SOURCE_PRIORITY[left.source];
    if (priority !== 0) return priority;
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.assetId.localeCompare(right.assetId);
  })[0];
}

const VIDEO_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_EXTENSION = /^(?:webp|png|jpe?g)$/i;

/** Build the portable, forward-slash path persisted in the assets table. */
export function assetRelativePath(
  videoId: string,
  kind: AssetKind,
  extension: string,
): string {
  if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error("invalid video identity");
  const ext = extension.replace(/^\./, "").toLowerCase();
  if (!SAFE_EXTENSION.test(ext)) throw new Error("unsupported asset extension");
  const fileName = `${kind}.${ext}`;
  return `${videoId}/${fileName}`;
}

/** Validate a database path before it is joined to Data/assets. */
export function isSafeAssetRelativePath(value: string): boolean {
  if (!value || value.includes("\0") || /[\r\n]/.test(value)) return false;
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  if (/^[A-Za-z]:/.test(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return segments.length >= 2 && SAFE_EXTENSION.test(path.posix.extname(normalized).slice(1));
}

/** Resolve an asset path while preserving the path-traversal invariant. */
export function assetAbsolutePath(assetRoot: string, relative: string): string | null {
  if (!isSafeAssetRelativePath(relative)) return null;
  const normalized = relative.replaceAll("/", path.sep).replaceAll("\\", path.sep);
  const root = path.resolve(assetRoot);
  const candidate = path.resolve(root, normalized);
  const relativeToRoot = path.relative(root, candidate);
  if (
    relativeToRoot === "" ||
    relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }
  return candidate;
}
