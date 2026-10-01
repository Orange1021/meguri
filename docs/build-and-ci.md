# Build and CI

This document covers the npm scripts, the electron-vite build, the two-project
test setup, packaging, continuous integration, and Docker-based development.

## npm scripts

```bash
npm install        # postinstall rebuilds better-sqlite3 for Electron
npm run dev        # development mode (electron-vite dev)
npm run build      # build main / preload / renderer into out/
npm run preview    # launch the built app (= npm start)
npm run dist       # produce distributables (electron-builder)
npm run dist -- --win portable  # produce the Windows portable package
npm run typecheck  # tsc --noEmit over both src and electron
npm test           # regression tests (Vitest): core then renderer
npm run install:local  # install into the local environment
```

`dev`, `preview`, and `start` go through `scripts/run-electron-vite.mjs` rather
than calling `electron-vite` directly. The wrapper strips
`ELECTRON_RUN_AS_NODE` (which the test runner sets) from the environment before
launching, so Electron does not accidentally start in node mode.

Development resolves its portable root to `<checkout>/.portable-dev`. Set
`MEGURI_PORTABLE_ROOT` to isolate a run in a temporary directory. Packaged
Windows builds resolve the root as the parent of `App/` and therefore keep
`Data/` and `Media/` beside the executable's `App/` directory. The explicit
`PORTABLE_EXECUTABLE_DIR` input is available to launchers that know the App
directory independently.

## electron-vite config

`electron.vite.config.ts` builds main, preload, and renderer from one config.

- Preload is emitted as **CommonJS** (`.js`); ESM `.mjs` preload can fail to
  load, and `electron/main.ts` resolves the preload, the renderer entry and
  the query worker through `__dirname`, which assumes CJS output.
- TypeScript uses separate tsconfigs for `src` and `electron`, both `strict` with
  `noUnusedLocals` / `noUnusedParameters`.

## Testing

Tests run under Vitest (`vitest.config.ts`) as two projects.

### Core project

`npm run test:core` covers the main/core logic (`electron/**/*.test.ts`). Because
better-sqlite3 is built for Electron's ABI, this **runs Electron as Node**
(`ELECTRON_RUN_AS_NODE=1` plus `--experimental-require-module` to allow
`require()` of ESM). It exercises real SQL against an in-memory SQLite database.
The launcher sets this environment in a Windows-safe way, so the native module
uses Electron's ABI instead of the system Node ABI.
The config carries a plugin that resolves NodeNext-style `.js` import specifiers
to `.ts`.

### Renderer project

`npm run test:renderer` covers the renderer (`src/**/*.test.{ts,tsx}`, jsdom).
With no native dependency it runs under plain Node; it is kept separate because
the jsdom worker does not start under Electron's experimental loader.

## Packaging

`npm run dist` runs `electron-vite build` then `electron-builder`. The builder's
`asarUnpack` includes better-sqlite3, ffmpeg-static, and
@hoardodile/ffprobe-bin; code that uses ffmpeg paths must apply the
`app.asar` → `app.asar.unpacked` substitution (see
[ffmpeg/ffprobe path resolution](media-pipeline.md#ffmpegffprobe-path-resolution)).

Distribution targets are Linux (AppImage / deb), Windows (nsis / portable), and
macOS (dmg / zip).

### Portable artifact checks

After `npm run dist -- --win portable`, inspect the generated
`release/Meguri-<version>-win32-x64.exe`. A portable smoke check should verify:

1. the artifact launches with `App/` resources available;
2. first launch creates `Data/` beside `App/`, not a database below Electron's
   system `userData`;
3. scanning a folder below `Media/` writes `Data/config.json` and
   `Data/roots/<workspaceId>/db.sqlite`;
4. replacing only `App/` leaves the configuration and database hashes unchanged;
5. a copy with an equivalent `Media/` layout resolves the same portable-relative
   workspace and reuses the same workspace database.

The repository E2E smoke test uses `MEGURI_PORTABLE_ROOT` to exercise the same
startup boundary without mutating the developer's checkout. A physical second
drive is not required for that test; if a release is manually moved to another
drive, record that verification separately.

### macOS code signing

There is no Apple developer certificate, so regular signing / notarization is
skipped (`CSC_IDENTITY_AUTO_DISCOVERY: false` in CI). Skipping alone is not
enough: electron-builder's repackaging invalidates the Electron binaries'
original signatures, and an app with an _invalid_ signature is rejected by
Gatekeeper on Apple silicon as "damaged" with no way to open it. The
`afterPack` hook (`scripts/mac-adhoc-sign.mjs`) therefore ad-hoc signs the
bundle, which restores a valid signature; users then only need the one-time
"Open Anyway" approval for an un-notarized app. If real certificates are
configured later (`CSC_LINK` / `CSC_NAME`), the hook steps aside
automatically.

## CI

GitHub Actions workflows live in `.github/workflows/`:

- `test.yml` runs `npm run typecheck` and `npm test`.
- `build.yml` triggers on `v*` tag pushes and builds a three-way matrix (linux
  x64, win x64, mac arm64), then creates a draft release.

ffmpeg-static and @hoardodile/ffprobe-bin each fetch a single-architecture
binary at install time (`npm_config_arch || os.arch()`), so CI pins
`npm_config_arch` to the target arch to keep the bundled binaries consistent.
The project uses ffprobe 9.0.1 so HEIF grid images are probeable on Windows as
well as on the development platforms.

## Docker development

Development can also run in Docker (Wayland assumed):

```bash
docker compose up
```

`HOST_MEDIA_DIR` selects the directory to scan, and `RENDER_GID` / `VIDEO_GID`
set the GPU groups via `.env` (`Dockerfile` / `docker-compose.yml`). The dev
container seeds its initial workspace list from `samples/config.json` via
`scripts/seed-sample-config.mjs`; set `MEGURI_SEED_SAMPLE_CONFIG=force` to reset
to the sample state.
