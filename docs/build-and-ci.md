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
npm run dist:portable  # assemble the Windows portable folder
npm run typecheck  # tsc --noEmit over both src and electron
npm test           # core, renderer, and portable-upgrade regression tests
npm run test:portable-upgrade  # App slot activation/rollback regression tests
npm run test:portable-smoke    # launch, replace EXE, and verify portable Data
npm run install:local  # install into the local environment
```

`dev`, `preview`, and `start` go through `scripts/run-electron-vite.mjs` rather
than calling `electron-vite` directly. The wrapper strips
`ELECTRON_RUN_AS_NODE` (which the test runner sets) from the environment before
launching, so Electron does not accidentally start in node mode.

Development resolves its portable root to `<checkout>/.portable-dev`. Set
`MEGURI_PORTABLE_ROOT` to isolate a run in a temporary directory. Packaged
Windows builds keep `Data/` and `Media/` beside the executable. The
`dist:portable` workflow assembles the final copyable directory at `橙映/` and
removes its temporary staging directory after packaging. The runtime also
accepts the legacy `App/` layout for existing installations. The explicit
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

### Coverage boundaries

The test layers intentionally cover different failure classes:

- Core tests validate SQL, scanning, asset selection, and reopening the same
  portable database. They do not exercise Chromium's media decoder.
- Renderer tests use jsdom, where `HTMLMediaElement` is a stub. A moving
  progress value in a renderer unit test is not evidence that a real MP4 has
  decoded video frames.
- Electron E2E tests use real files. The video case asserts decoded dimensions
  and a changing playback clock, not only that the player dialog opened.
- The Windows packaged smoke test runs the self-extracting portable artifact,
  waits for a real database under `Data/`, replaces only the EXE, and verifies
  that the same portable data remains usable.

This leaves codec-specific coverage as an explicit follow-up: add one small
fixture per supported compatibility class (for example AVI, WMV, and MOV) when
we need to protect a particular decoder or transcoding path. A single MP4
fixture protects the common path without making every test run large.

## Packaging

`npm run dist` runs `electron-vite build` then `electron-builder`. The builder's
`asarUnpack` includes better-sqlite3, ffmpeg-static, and
@hoardodile/ffprobe-bin; code that uses ffmpeg paths must apply the
`app.asar` → `app.asar.unpacked` substitution (see
[ffmpeg/ffprobe path resolution](media-pipeline.md#ffmpegffprobe-path-resolution)).

Distribution targets are Linux (AppImage / deb), Windows (nsis / portable), and
macOS (dmg / zip).

### Portable artifact checks

After `npm run dist:portable`, inspect the generated `橙映/` directory. It must
contain only `橙映.exe`, `Data/`, and `Media/`; the version/platform-suffixed
builder artifact exists only in the temporary `.portable-build/` directory.
A portable smoke check should verify:

1. `橙映/橙映.exe` launches with its packaged resources available;
2. first launch creates `橙映/Data/`, not a database below Electron's system
   `userData`;
3. scanning a folder below `橙映/Media/` writes `橙映/Data/config.json` and
   `橙映/Data/roots/<workspaceId>/db.sqlite`;
4. replacing only `橙映.exe` leaves the configuration hash and indexed media
   record unchanged;
5. a copy with an equivalent `橙映/Media/` layout resolves the same
   portable-relative workspace and reuses the same workspace database.

The final `橙映/` directory is intentionally ignored by Git because it contains
the user's database and media. Commit the build script and documentation, never
the generated directory or its contents.

Run the Windows-only packaged smoke test after building the directory:

```powershell
npm run dist:portable
npm run test:portable-smoke
```

The smoke test copies the packaged EXE into an isolated temporary portable root,
seeds a minimal valid `Data/config.json`, indexes the checked-in short MP4
fixture, launches the real packaged program, replaces only the EXE, and launches
it again. It then verifies that the portable log, configuration, marker file,
and indexed database remain under the same `Data/` directory. On non-Windows
hosts the command reports that it was skipped.

The Windows unpacked directory also contains `portable-manifest.json`. It is
the release operator's compatibility contract for an `App.new` candidate. To
exercise the upgrade and rollback transaction against a portable root:

```powershell
npm run test:portable-upgrade
node scripts/portable-upgrade.mjs --root D:\PortableVideoLibrary --activate
node scripts/portable-upgrade.mjs --root D:\PortableVideoLibrary --rollback
```

Keep 橙映 closed while a slot operation runs. The command only renames
`App`, `App.new`, and `App.previous`; it does not copy, migrate, or remove
`Data`/`Media`. On the next launch the normal migration path makes a
pre-migration backup and sends an incompatible schema to the recovery screen.
If a process is interrupted between renames, rerun the command with
`--recover` (the other commands recover automatically first).

The repository E2E smoke test uses `MEGURI_PORTABLE_ROOT` to exercise the same
startup boundary without mutating the developer's checkout. A physical second
drive is not required for that test; if a release is manually moved to another
drive, record that verification separately.

The E2E suite also contains a real playback case using
`e2e/fixtures/video-media/flower.mp4`. It waits for decoded dimensions and a
changing playback clock, so a test can no longer pass merely because the
progress bar moved while the video renderer failed to decode frames.

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
