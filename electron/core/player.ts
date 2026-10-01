import fs from "node:fs";
import path from "node:path";

export interface PotPlayerLaunch {
  executable: string;
  args: string[];
}

export interface PlayerDiscoveryOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (file: string) => boolean;
}

export interface DiscoveredPotPlayer {
  path: string;
  source: "configured" | "program-files" | "local-app-data";
}

export function buildPotPlayerLaunch(
  executable: string,
  playlistPath: string,
): PotPlayerLaunch {
  if (!path.isAbsolute(executable) || !path.isAbsolute(playlistPath)) {
    throw new Error("PotPlayer paths must be absolute");
  }
  return { executable, args: [playlistPath] };
}

export function discoverPotPlayer(
  options: PlayerDiscoveryOptions = {},
): DiscoveredPotPlayer | null {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return null;
  const env = options.env ?? process.env;
  const exists = options.exists ?? fs.existsSync;
  const configured = env.MEGURI_POTPLAYER_PATH?.trim();
  if (configured && exists(configured)) {
    return { path: configured, source: "configured" };
  }
  const candidates: Array<{ file: string; source: DiscoveredPotPlayer["source"] }> = [];
  for (const root of [env.ProgramFiles, env["ProgramFiles(x86)"]]) {
    if (!root) continue;
    candidates.push(
      { file: path.join(root, "DAUM", "PotPlayer", "PotPlayerMini64.exe"), source: "program-files" },
      { file: path.join(root, "DAUM", "PotPlayer", "PotPlayerMini.exe"), source: "program-files" },
      { file: path.join(root, "PotPlayer", "PotPlayerMini64.exe"), source: "program-files" },
    );
  }
  if (env.LOCALAPPDATA) {
    candidates.push(
      { file: path.join(env.LOCALAPPDATA, "Programs", "DAUM", "PotPlayer", "PotPlayerMini64.exe"), source: "local-app-data" },
      { file: path.join(env.LOCALAPPDATA, "DAUM", "PotPlayer", "PotPlayerMini64.exe"), source: "local-app-data" },
    );
  }
  const found = candidates.find((candidate) => exists(candidate.file));
  return found ? { path: found.file, source: found.source } : null;
}
