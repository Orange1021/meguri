# Phase 3–5 Assets, Playlists, and External Playback Plan

## Goal

Finish the remaining V1 capabilities from the portable-video-library方案 while
preserving the phase 1/2 compatibility bridge:

1. Persist versioned Cover/Sheet/manual assets without overwriting manual work.
2. Persist static and rule-based playlists with a validated AND/OR/NOT AST.
3. Generate current-drive UTF-8 M3U8 files and launch PotPlayer through an
   argument-array adapter, with safe fallbacks when it is unavailable.

## Compatibility boundaries

- Existing `files`, `file_meta`, tags, history, collections, and media IPC DTOs
  remain valid.
- New schema versions are append-only and checksummed; opening an existing
  phase-2 database is idempotent.
- Existing thumbnail URLs continue to work. The new asset layer is a durable
  projection and can use the existing thumbnail as its auto Cover source.
- Playlist queries are workspace-local because each workspace owns a SQLite
  database. Cross-workspace collections remain on their existing compatibility
  path until the formal `video_files` migration.
- External process launch accepts an executable path and argument array only;
  no shell command string is constructed.

## Deliverables

### Phase 3 — visual assets

- Migration v3: `assets` and `asset_tasks` tables.
- Pure source-priority and asset-path helpers.
- Atomic asset writes, retryable task state, Cover and 4×4 Sheet generation.
- Manual asset import and restore-auto operations through typed IPC.
- Media-server asset route with root-scoped path validation.

### Phase 4 — tags and playlists

- Migration v4: `playlists` and `playlist_items` tables.
- Versioned recursive rule AST with limits and deterministic normalization.
- SQL-backed evaluation for tag, AND, OR, NOT, kind, favorite, rating, and
  played predicates.
- CRUD IPC for static/smart playlists and ordered item resolution.

### Phase 5 — export and playback

- M3U8 writer that skips missing files, preserves order, emits UTF-8 and uses
  current absolute paths at export time.
- PotPlayer discovery/configuration and injected process-launch adapter.
- Typed IPC for player discovery, M3U8 export, and opening a playlist.
- AVI/WMV external-playback policy while retaining Chromium playback for stable
  in-app containers.

## Verification

- Unit tests for schema migrations, source selection, asset path safety, sheet
  timing, rule normalization/evaluation, M3U8 escaping/order, player discovery,
  and argument-array launch.
- Existing core, renderer, E2E, typecheck, portable build, and portable smoke
  gates remain green.
