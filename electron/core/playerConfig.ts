import fs from "node:fs";
import path from "node:path";

function configPath(dataDir: string): string {
  return path.join(dataDir, "player.json");
}

export function loadConfiguredPlayer(dataDir: string): string | null {
  try {
    const value = JSON.parse(fs.readFileSync(configPath(dataDir), "utf8")) as {
      potPlayerPath?: unknown;
    };
    return typeof value.potPlayerPath === "string" && value.potPlayerPath
      ? value.potPlayerPath
      : null;
  } catch {
    return null;
  }
}

export function saveConfiguredPlayer(
  dataDir: string,
  potPlayerPath: string | null,
): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const destination = configPath(dataDir);
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ potPlayerPath }, null, 2), {
    encoding: "utf8",
  });
  try {
    fs.renameSync(temporary, destination);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
