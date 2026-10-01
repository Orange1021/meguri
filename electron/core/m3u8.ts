import { randomUUID } from "node:crypto";
import { promises as fsPromises } from "node:fs";
import path from "node:path";

export interface M3u8Entry {
  path: string | null;
  title: string;
  duration: number | null;
}

export interface M3u8WriteResult {
  path: string;
  included: number;
  skipped: number;
}

function cleanLine(value: string): string {
  return value
    .replaceAll("\0", " ")
    .replace(/[\r\n]/g, " ")
    .trim();
}

/** Build an extended M3U8 document with CRLF for Windows players. */
export function buildM3u8(entries: readonly M3u8Entry[]): string {
  const lines = ["#EXTM3U"];
  for (const entry of entries) {
    if (!entry.path) continue;
    const duration =
      entry.duration != null && Number.isFinite(entry.duration)
        ? Math.max(0, Math.round(entry.duration))
        : 0;
    lines.push(`#EXTINF:${duration},${cleanLine(entry.title)}`);
    lines.push(cleanLine(entry.path));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export async function writeM3u8(
  tempDir: string,
  entries: readonly M3u8Entry[],
  fileName = `playlist-${randomUUID()}.m3u8`,
): Promise<M3u8WriteResult> {
  if (!/^[A-Za-z0-9._-]+\.m3u8$/i.test(fileName)) {
    throw new Error("invalid playlist file name");
  }
  await fsPromises.mkdir(tempDir, { recursive: true });
  const destination = path.resolve(tempDir, fileName);
  const root = path.resolve(tempDir);
  const relative = path.relative(root, destination);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("playlist path escapes temp directory");
  }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const output = buildM3u8(entries);
  try {
    const handle = await fsPromises.open(temporary, "w");
    try {
      await handle.writeFile(output, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fsPromises.rename(temporary, destination);
  } catch (error) {
    await fsPromises.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return {
    path: destination,
    included: entries.filter((entry) => entry.path != null).length,
    skipped: entries.filter((entry) => entry.path == null).length,
  };
}
