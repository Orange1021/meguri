/**
 * Raster companion for the Windows notification-area icon.
 *
 * Generated from logo/orange-logo.svg by scripts/render-orange-icon.mjs.
 * Windows' Tray path does not reliably rasterize the SVG Data URL used by the
 * window icon, so keep this small PNG embedded in the main-process bundle.
 */
const ORANGE_TRAY_ICON_BASE64 = [
  "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",
].join("");

export const ORANGE_TRAY_ICON_DATA_URL = `data:image/png;base64,${ORANGE_TRAY_ICON_BASE64}`;
