// Format helpers shared across the renderer. Two flavors:
// - Lists (grid cards / list rows): compact m:ss, empty/null fallback so falsy values
//   are dropped by Boolean filters or string concatenation.
// - Details (MediaDetail / Discover): h:mm:ss when applicable, with an em-dash
//   placeholder so empty values still render a visible "—".

export function formatDuration(
  d: number | null,
  opts: { hours?: boolean; fallback?: string } = {},
): string {
  const { hours = false, fallback = "" } = opts;
  if (!d || d <= 0) return fallback;
  if (hours) {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor(d % 60);
    const mm = m.toString().padStart(2, "0");
    const ss = s.toString().padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }
  const m = Math.floor(d / 60);
  const s = Math.floor(d % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// `bytes` falsy (null/0) returns the fallback. Default fallback is "" so that
// list views' Boolean filters drop the value; details pass "—" explicitly.
export function formatSize(bytes: number | null, fallback = ""): string {
  if (!bytes) return fallback;
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// Video resolution classes, highest first: label, shorter side, longer side.
const VIDEO_CLASSES: readonly [string, number, number][] = [
  ["8K", 4320, 7680],
  ["4K", 2160, 3840],
  ["QHD", 1440, 2560],
  ["FHD", 1080, 1920],
  ["HD", 720, 1280],
];

/**
 * Short quality label shown beside a resolution: a video's class, an image's
 * megapixels. Empty when the dimensions are unknown.
 *
 * A video takes the higher of the classes its shorter and longer sides reach,
 * so a portrait 1080×1920 clip is FHD and a letterboxed 1280×534 one is HD.
 */
export function resolutionBadge(
  kind: string,
  width: number | null,
  height: number | null,
): string {
  if (!width || !height) return "";
  if (kind === "image") {
    // Rounded before the threshold, so 9.98 MP reads "10 MP" and not "10.0".
    const mp = Math.round((width * height) / 100_000) / 10;
    if (mp < 0.1) return "<0.1 MP";
    return `${mp < 10 ? mp.toFixed(1) : Math.round(mp)} MP`;
  }
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const hit = VIDEO_CLASSES.find(([, s, l]) => short >= s || long >= l);
  return hit ? hit[0] : "SD";
}
