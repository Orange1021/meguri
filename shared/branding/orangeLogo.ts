/**
 * Canonical Meguri application mark.
 *
 * `logo/orange-logo.svg` is the reviewable static mirror of this source. Keep
 * the SVG here so both the renderer bundle and Electron's nativeImage can use
 * exactly the same vector without relying on a font or a bundle-relative path.
 */
export const ORANGE_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-labelledby="title desc">
  <title id="title">Meguri orange</title>
  <desc id="desc">A round orange fruit with a green leaf</desc>
  <defs>
    <radialGradient id="fruit" cx="34%" cy="26%" r="78%">
      <stop offset="0" stop-color="#fdba74" />
      <stop offset="0.42" stop-color="#f97316" />
      <stop offset="1" stop-color="#ea580c" />
    </radialGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#4d7c0f" />
      <stop offset="1" stop-color="#84cc16" />
    </linearGradient>
  </defs>
  <circle cx="128" cy="139" r="91" fill="#9a3412" opacity="0.22" />
  <circle cx="128" cy="132" r="86" fill="url(#fruit)" stroke="#c2410c" stroke-width="5" />
  <path d="M76 103c25-24 55-31 85-18" fill="none" stroke="#fed7aa" stroke-linecap="round" stroke-width="8" opacity="0.48" />
  <path d="M94 171c22 14 55 18 79 4" fill="none" stroke="#c2410c" stroke-linecap="round" stroke-width="5" opacity="0.34" />
  <path d="M131 50c8-23 31-35 57-27-10 22-29 34-57 27Z" fill="url(#leaf)" stroke="#365314" stroke-width="4" stroke-linejoin="round" />
  <path d="M132 53c-8 15-14 25-25 34" fill="none" stroke="#365314" stroke-linecap="round" stroke-width="7" />
  <ellipse cx="91" cy="88" rx="25" ry="13" fill="#fff7ed" opacity="0.36" transform="rotate(-28 91 88)" />
</svg>`;

export const ORANGE_LOGO_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ORANGE_LOGO_SVG)}`;
