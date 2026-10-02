<div align="center">

<img src="./logo/app-512.png" width="160" alt="橙映 logo">

# 橙映

**Redefining what a media manager is supposed to be.**

A local-first media library for your videos and photos — scan, browse,
search, and play, all offline.

[![Test](https://github.com/zabuton-app/meguri/actions/workflows/test.yml/badge.svg)](https://github.com/zabuton-app/meguri/actions/workflows/test.yml)
[![Build](https://github.com/zabuton-app/meguri/actions/workflows/build.yml/badge.svg)](https://github.com/zabuton-app/meguri/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/zabuton-app/meguri?include_prereleases)](https://github.com/zabuton-app/meguri/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-8a9a7b)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/amgsk)

</div>

橙映 is a personal desktop app for browsing, searching, and playing local
videos and images with thumbnails. It recursively scans any folder you point it at,
generates thumbnails, tags, and metadata, and lets you browse the collection in
a native window.

> 中文用户：请先阅读 [简体中文使用文档](./docs/user-guide-zh-CN.md)，里面包含首次配置、主要功能和 Windows 便携版数据说明。

橙映 is named for its orange visual identity and the idea of revisiting local
media and rediscovering something worth coming back to.

Built with **Electron + Node/TypeScript + React**. Chromium is bundled, so video
playback and rendering are largely insulated from the host environment. The only
native dependency is SQLite (better-sqlite3); ffmpeg/ffprobe ship as static
binaries, so no system-side ffmpeg is required.

![橙映 demo — browsing, search, playback, and Discovery](./docs/assets/demo.gif)

## Philosophy

橙映 exists to redefine what a media manager is supposed to be. The
category has settled into a set of assumptions — an account to sign up for, a
cloud your files are uploaded to, a subscription to keep paying, a catalog
that quietly reports what you watch. 橙映 starts from the opposite premise: your library lives on
your disk, it stays there, and the tool that browses it owes you nothing but a
good time. Everything runs offline, nothing phones home, the whole thing is
[free forever](#free-forever), and the source is yours to read. What is left
once those assumptions are gone is the part that actually matters — finding,
rediscovering, and enjoying what you already have.

## 🔭 Discovery — find something new

**Stumble upon what you forgot you had.** The bigger a library grows, the more
of it sinks out of sight. Discovery deals you a random hand from your library
and shows each pick full-screen — the video front and center over a blurred
backdrop, with a rail of scene previews to jump from — so every visit surfaces
something worth rediscovering. One click reshuffles the deck; one more starts
playback.

![Discovery demo — immersive random picks with a scene-preview rail and reshuffle](./docs/assets/discover.gif)

## 📺 Playlist — press play and let it run

**Any list can play itself.** A collection, Watch Later, a workspace listing or
a search result — hit play and a full-screen player takes the list exactly as it
is on screen and runs it hands-off: videos play to the end, images hold for a
few seconds with a slow pan and zoom, and the player moves on by itself. Shuffle
and repeat are one click away, collections can be dragged into the order you
want, and pressing `I` steps out to the current file's detail view —
coming back resumes right where it left off. It works the other way round
too: any file's detail view can start the playlist from that file, and
whatever is playing there carries straight on. Browsing by folder, it plays the
whole folder — every subfolder included, by name unless you chose a sort — so a
music folder of albums plays through album by album.

![Playlist demo — a full-screen player running a list hands-off, with shuffle and auto-advance](./docs/assets/playlist.gif)

## Download

Windows users can install 橙映 from the
[Microsoft Store](https://apps.microsoft.com/detail/9NRSM11RRH8Z).

[![Get it from Microsoft](https://get.microsoft.com/images/en-us%20dark.svg)](https://apps.microsoft.com/detail/9NRSM11RRH8Z)

Prebuilt packages for all platforms are also available on
[GitHub Releases](https://github.com/zabuton-app/meguri/releases).

| Platform | Packages                                      |
| -------- | --------------------------------------------- |
| Linux    | AppImage / deb                                |
| Windows  | Microsoft Store / Installer (NSIS) / portable |
| macOS    | dmg / zip (Apple silicon)                     |

### macOS: first launch

橙映 is not yet notarized by Apple (that requires a paid developer account;
proper code signing and notarization are planned), so the first launch is
blocked with an "Apple could not verify…" dialog. To allow it:

1. Open the app once and dismiss the dialog.
2. Open **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to the 橙映 entry.

Alternatively, clear the quarantine flag from the terminal:

```bash
xattr -d com.apple.quarantine /Applications/橙映.app
```

If macOS instead says the app **"is damaged and can't be opened"**, you are
running a build from v0.1.0 or earlier that shipped with a broken code
signature — download the latest release, which is ad-hoc signed and only
needs the one-time approval above.

### Arch Linux (AUR)

[meguri-bin](https://aur.archlinux.org/packages/meguri-bin) is the package
maintained by this project. It installs the prebuilt release binaries, so it
is the recommended way to install 橙映 on Arch. Install it with your favorite
AUR helper:

```bash
yay -S meguri-bin
# or: paru -S meguri-bin
```

Or build it manually:

```bash
git clone https://aur.archlinux.org/meguri-bin.git
cd meguri-bin
makepkg -si
```

A third-party [meguri](https://aur.archlinux.org/packages/meguri) package, which
builds from source against the distribution's Electron, is also available:

```bash
yay -S meguri
```

That one is maintained by a community packager, not by this project: it is
unofficial, its build is not verified here, and it may lag behind the latest
release. Check its version before installing if you want the newest features.

Or run from source — see [Setup and Launch](#setup-and-launch).

## Features

- 🗂️ **Workspaces** — manage multiple media directories with a Slack-style
  sidebar to add, switch, and remove them; each root gets its own database and
  thumbnails
- ⚡ **Fast, incremental scanning** — recursive walks with mtime/size checks
  and move/rename tracking via content hashes
- 🖼️ **Automatic thumbnails** — WebP thumbnails for both images and videos,
  generated by the bundled ffmpeg; hovering a video thumbnail scrubs through
  its scenes like a seek bar (toggleable in Settings)
- 🎵 **Audio** — music and other audio files are scanned alongside video and
  images, with embedded cover art as their thumbnails; a click plays them in a
  bottom player bar that keeps going while you browse, the detail view holds
  their tags, rating, and history like any other file, and a live spectrum
  plays over the cover art while a track plays — twelve patterns from bars
  and an LED meter to particles and ripples, chosen in Settings or stepped
  through with V
- 🎬 **Smooth playback** — Range-enabled streaming from a local HTTP server;
  non-faststart containers are remuxed to fragmented MP4 on the fly (time seek
  via `?t`), and unplayable codecs are handed off to the OS default player
- 🔍 **Powerful search** — filter and sort by full text (FTS5), tags, kind,
  rating, and capture date/time, with conditions shown as removable badges
- 🏷️ **Tags, ratings & history** — manual tags with autocomplete, ★ ratings,
  and playback history that survive file moves and renames, plus a day-grouped
  history timeline across all workspaces
- 🔭 **Discovery** — an immersive shuffle mode that resurfaces random picks
  from your library full-screen with a scene-preview rail
  ([see above](#-discovery--find-something-new))
- 📺 **Playlist playback** — play any list hands-off in a full-screen player,
  with shuffle, repeat, manual ordering, and timed images
  ([see above](#-playlist--press-play-and-let-it-run))
- 📋 **Copy to clipboard** — copy any image to the clipboard from the detail
  view, ready to paste elsewhere
- 📑 **Side peek** — open any file's detail as a resizable sheet docked beside
  the library instead of a modal, keeping the grid, search, and player bar in
  use while you watch, tag, and rate; 橙映 remembers which you prefer
- 🎨 **Themes** — base16-based multi-theme switching (gruvbox / solarized /
  monokai / nord / dracula, etc.)
- 🔎 **Content zoom** — Ctrl + wheel (and Ctrl +/-/0)
- 🔒 **Privacy-first** — no telemetry, no analytics, no external network
  communication ([see below](#privacy))

## Screenshots

The detail view docked beside the library as a side peek:

![Side peek](./docs/assets/side-peek.png)

A track playing in the bottom player bar while browsing:

![Audio player bar](./docs/assets/audio.png)

A live spectrum on the detail view while a track plays, in one of twelve
patterns:

![Audio spectrum](./docs/assets/spectrum.png)

![The twelve spectrum patterns](./docs/assets/spectrum-patterns.png)

Grid and list layouts for browsing:

![List view](./docs/assets/view-list.png)

Every corner of the UI follows your base16 theme:

| gruvbox dark                                          | nord dark                                       | solarized light                                             |
| ----------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| ![gruvbox dark](./docs/assets/theme-gruvbox-dark.png) | ![nord dark](./docs/assets/theme-nord-dark.png) | ![solarized light](./docs/assets/theme-solarized-light.png) |

## Requirements

- Node.js 22.22+ / npm
- Build time only: a C/C++ toolchain (for the native build of better-sqlite3)

No runtime system dependencies are required (Chromium, ffmpeg, and SQLite are
bundled).

## Setup and Launch

### Install dependencies

```bash
npm install
```

`postinstall` rebuilds better-sqlite3 for Electron.

### Development mode

```bash
npm run dev
```

Directories can be added from within the app (the "+" in the left sidebar). If
you launch without any directory added, a screen prompting you to add one is
shown. To provide an initial directory at startup, specify it via an environment
variable (once added, it is persisted to settings thereafter).

```bash
MEGURI_ROOT=/path/to/media npm run dev
```

Development data is kept in `.portable-dev/` inside the checkout. You can point
the same build at a disposable location with `MEGURI_PORTABLE_ROOT`; this is
useful for tests and for keeping a development checkout clean. On a first launch
with no `Data/config.json`, choose **Initialize** on the recovery screen; the
app then restarts and applies `MEGURI_ROOT` if it was supplied.

### Docker development mode

```bash
docker compose up --build dev
```

The Docker dev container seeds its initial workspace list from
`samples/config.json` into the persisted app data volume on first run. To reset a
local Docker workspace back to the sample state, remove the Docker volume or run
the seed step with `MEGURI_SEED_SAMPLE_CONFIG=force`.

### Build / distribution packages

```bash
npm run build      # build main / preload / renderer
npm run dist       # generate AppImage / deb (electron-builder)
npm run dist:portable  # generate the Windows portable folder
```

### Type checking

```bash
npm run typecheck
```

### Testing

Unit tests (Vitest: main/core + renderer):

```bash
npm test
```

On Windows, `npm run test:core` starts Vitest through the Electron runtime so
the `better-sqlite3` ABI matches the application. The command is also useful
when you only need the core suite.

E2E tests (Playwright + Electron). Builds the app first, then launches the
packaged main process against fixture media in `e2e/fixtures/media/`. Run them
under a virtual framebuffer (Linux, needs `xvfb-run`) so no windows appear on
your desktop; CI runs the same script:

```bash
npm run test:e2e:headless
```

To watch the app while debugging, run on the current display instead:

```bash
npm run test:e2e
```

CI installs Playwright browser dependencies with `npm run test:e2e:install`
(Ubuntu/Debian only). On other distros (e.g. Arch), skip `--with-deps` if you
already run Electron apps locally.

## Basic Usage

| Action     | How                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Scan       | Runs automatically at startup. Re-scan via the header "Scan" (incremental, move tracking)                            |
| Play       | Click a thumbnail → play in the detail view (audio plays in the bottom bar). When unsupported, use "Open externally" |
| Tag / Rate | Assign in the detail view (tags have autocomplete). Click a tag in the grid to search                                |
| Search     | Filter and sort by full text, kind, and rating in the top bar (conditions shown as badges, individually removable)   |
| Theme      | Switch from Theme at the top-right of the header                                                                     |
| Zoom       | Ctrl + wheel, Ctrl +/-, Ctrl + 0 to reset                                                                            |

## Where Data Is Stored

The Windows portable build is assembled into the `橙映/` directory. Copy that
directory as a whole; it contains the executable, user data, and the optional
portable media root. The build staging directory is temporary and is removed
after packaging.

```text
PortableVideoLibrary/
├─ 橙映/
│  ├─ 橙映.exe
│  ├─ Data/
│  │  ├─ config.json         # workspace locators and user collections
│  │  ├─ roots/<workspaceId>/
│  │  │  ├─ db.sqlite        # workspace index and metadata (WAL)
│  │  │  └─ thumbs/          # generated thumbnails (WebP)
│  │  ├─ assets/             # derived assets
│  │  ├─ playlists/          # reserved for playlist exports
│  │  ├─ backups/<backupId>/ # validated database/config snapshots
│  │  ├─ logs/               # rotated application log
│  │  └─ temp/               # crash-safe import and restore staging
│  └─ Media/                 # the default portable media root
└─ (source files)             # not needed for portable use
```

Workspaces below `橙映/Media/` are stored as portable-relative locators. Their
persisted `workspaceId` names the database directory, so changing the drive
letter or replacing only `橙映.exe` does not create a second database. A
workspace outside `橙映/Media/` is retained as an explicit absolute locator and
is therefore not portable across machines or drive layouts.

On first launch, 橙映 creates the directory structure but does not silently
create a database in Electron's system `userData`. If `Data/config.json` is
missing or a migration cannot be completed, the recovery page shows the exact
`Data` directory and offers only the applicable action: initialize, retry, or
restore a validated backup. Legacy data in the old system `userData` location
is copied into `Data` with checksum verification; the source is retained until
the user removes it explicitly.

Schema migrations have versions and SHA-256 checksums. Before a pending
migration, 橙映 creates a SQLite-consistent backup containing the database,
configuration, sizes, hashes, schema version, and restore target. A backup is
listed for restore only after its manifest and both snapshot hashes validate.

Your media files themselves are never touched: 橙映 only ever **reads**
the directories you register, and all of its own library data stays under
`橙映/Data` above. The short-lived single-instance control file may still be placed
under Electron's `userData`; it contains only a local control token and is
removed when the app exits. Nothing 橙映 does can destroy or modify your
videos and images.

### Portable upgrades

Close 橙映 and replace only `橙映/橙映.exe` with the newly built file. Keep
`橙映/Data/` and `橙映/Media/` in place. Database migrations create a validated
backup before writing; copying `Data/` separately before an upgrade is still
recommended.

## Free, forever

橙映 is **free software and always will be**. There is no paid tier, no
subscription, no in-app purchase, no license key, and no ads — and none will
ever be added. Every feature, present and future, is available to everyone
under the [MIT License](./LICENSE).

The Buy Me a Coffee link above is purely optional. Supporting the project
unlocks nothing and changes nothing about the app; it just helps keep it going.

## Privacy

橙映 is **privacy-first**: everything stays on your machine.

- **No telemetry, no analytics.** 橙映 contains no usage-tracking mechanism
  such as Google Analytics, crash reporters, or any other third-party
  measurement SDK.
- **No external network communication.** The app never sends your data —
  file names, paths, tags, search queries, playback history, or anything
  else — to any external server. The only network activity is a local HTTP
  media server bound to `127.0.0.1`, used solely to stream your own files to
  the app window.
- **Fully offline.** All features work without an internet connection.

## Architecture

```text
橙映/
├─ electron/                # main process (Node/TypeScript)
│  ├─ main.ts               # startup, windows, tray
│  ├─ scanManager.ts        # scan orchestration (start / abort, renderer events)
│  ├─ ipc/                  # IPC handlers, one module per domain
│  ├─ preload.ts            # contextBridge (window.api)
│  └─ core/                 # backend
│     ├─ db.ts              # better-sqlite3 + FTS5
│     ├─ scan.ts            # walk / content_hash / incremental & move tracking
│     ├─ media.ts           # ffprobe metadata + ffmpeg thumbnails
│     ├─ queries.ts         # cross-cutting search, file operations
│     ├─ tags.ts workspaces.ts
│     ├─ jobs.ts            # scan pipeline
│     └─ server.ts          # local HTTP media server (Range)
├─ src/                     # renderer (React + TypeScript)
│  ├─ ipc/                  # typed client for window.api
│  ├─ components/  routes/  themes/  hooks/
├─ electron.vite.config.ts  # unified build of main/preload/renderer
└─ index.html
```

The main process (Node) handles the DB, scanning, media indexing, and playback
support, while the renderer (React) talks IPC over `window.api` via `preload`.
Videos, images, and thumbnails are served from a local HTTP server inside the
main process.

## Contributors

**橙映 is actively looking for contributors — all contributions are
welcome!** 🎉

You don't need to write code to help. Ideas, feature requests, bug reports,
UI/UX feedback, translations, and documentation improvements are all just as
appreciated — if 橙映 could do something better for your library, please
[open an issue](https://github.com/zabuton-app/meguri/issues) and tell us
about it.

## Contributing

Issues and pull requests are welcome. Before opening a larger change, please
start with an issue so the scope and direction can be discussed first.

For development:

```bash
npm install
npm run dev
```

Before submitting a pull request, run:

```bash
npm run typecheck
npm test
npm run test:e2e:headless
```

Keep changes focused, avoid unrelated refactors, and include tests when a change
touches core behavior, persistence, media scanning, or user-facing workflows.

A few conventions to follow:

- **Write commit messages in English**, using the format
  `#<issue> <type>: <summary>` when the change is tied to an issue, or
  `<type>: <summary>` otherwise (types in use: `feat`, `fix`, `docs`, `chore`,
  `ci`, `build`).
- **Branch names** follow `feat/#<issue>-<short-description>`
  (e.g. `feat/#9-hover-preview`), branched from `main`.
- **Keep all locales in sync**: when adding or changing UI strings, update every
  locale in [src/i18n/locales/](src/i18n/locales/) (ja / en / es / fr / ko /
  zh-CN). `ja.ts` is the source of truth for translation keys.
- **Read the developer docs first**: [docs/README.md](docs/README.md) is the
  index of the architecture reference — worth a look before touching scanning,
  the database, IPC, or the media server.

## Disclaimer

橙映 is a personal-scale project provided **as is**, without warranty of any
kind. Use it at your own risk.

- **No liability for data loss.** Although 橙映 is designed to leave your
  original media files untouched and only manages its own metadata and
  thumbnails under `Data`, the authors accept no responsibility for any loss,
  corruption, or deletion of files or data that may occur while using it. Keep
  your own backups of anything important.
- **Operations are your responsibility.** Actions taken through the app — such as
  opening files in external applications, removing items from the index, or
  pointing it at a directory — are performed at your discretion and risk.
- **No guarantee of correctness or availability.** Scan results, metadata,
  thumbnails, and search output may be inaccurate or incomplete, and the app may
  stop working after OS or dependency updates.

See the [License](#license) section for the full legal terms.

## License

MIT
