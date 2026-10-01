import fs from "node:fs";
import path from "node:path";
import macAdhocSign from "./mac-adhoc-sign.mjs";

const PORTABLE_MANIFEST_NAME = "portable-manifest.json";

/**
 * electron-builder hook shared by Windows portable builds and macOS bundles.
 * The manifest is intentionally written into the unpacked application slot so
 * an App.new candidate can be validated before it is promoted. Data remains
 * outside the build output and is never copied into the artifact.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName === "win32") {
    const productFilename = context.packager.appInfo.productFilename;
    const manifest = {
      formatVersion: 1,
      appVersion: context.packager.appInfo.version,
      executable: `${productFilename}.exe`,
      minDataLayoutVersion: 1,
      maxDataLayoutVersion: 1,
      minConfigFormatVersion: 2,
      maxConfigFormatVersion: 2,
      migrationPolicy: "backup-before-migrate",
    };
    const manifestPath = path.join(context.appOutDir, PORTABLE_MANIFEST_NAME);
    const temporaryPath = `${manifestPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    fs.renameSync(temporaryPath, manifestPath);
    console.log(`[portable-manifest] wrote ${manifestPath}`);
  }

  await macAdhocSign(context);
}
