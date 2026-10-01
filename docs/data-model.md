# Data Model

Each workspace has its own SQLite database. This document covers the portable
storage layout, stable workspace identities, the schema, checksummed migrations
and backups, the `meta_key` design that keeps user-edited metadata durable,
full-text search, and the query layer.

## Storage layout

A release resolves its root from the executable location. `App` contains only
the replaceable program files; `Data` contains all library state; and `Media`
is the default portable media root:

```text
PortableVideoLibrary/
├─ App/
├─ Data/
│  ├─ config.json
│  ├─ roots/<workspaceId>/
│  │  ├─ db.sqlite   # this workspace's database (WAL mode)
│  │  ├─ thumbs/    # generated thumbnails (WebP)
│  │  └─ assets/    # versioned Cover/Sheet/manual assets
│  ├─ assets/
│  ├─ playlists/
│  ├─ backups/
│  ├─ logs/
│  └─ temp/
└─ Media/
```

`electron/core/portablePaths.ts` resolves these paths. During development the
root is `<checkout>/.portable-dev`; tests can inject a temporary root. The
top-level [README](../README.md#where-data-is-stored) is the user-facing
canonical description of the full storage tree.
`Data/assets/` and `Data/playlists/` remain reserved layout directories for
future shared artifacts; current workspace assets live beside the workspace
database, and M3U8 exports are written to `Data/temp/`.

### Workspace identity and locators

`Data/config.json` version 2 stores each workspace as a record containing a
`workspaceId`, display name, locator, the old path hash, and creation time. A
root below `Media` is serialized as a `/`-separated `portable-relative` locator;
an external root is serialized as an explicit `absolute` locator and is not
portable across drive layouts. The persisted workspace ID, rather than the
current absolute path hash, names `Data/roots/<workspaceId>`. This is what lets
a copied library keep using the same database after a drive-letter change or an
`App` replacement.

The reader still accepts the legacy `roots: string[]` configuration. On startup,
legacy `userData` is copied into `Data` through a temporary import directory,
SQLite snapshots are made with the backup API, every copied file is hashed, and
the source remains intact until the user chooses to remove it.

## Schema

All DDL lives in `electron/core/db.ts` (`CORE_DDL`). The database opens in WAL
mode with `synchronous = NORMAL` and `foreign_keys = ON`.

The main tables:

- `scan_roots` — the registered root for this database.
- `files` — the file index: `rel_path`, `abs_path`, `kind` (`video` | `image` |
  `audio`), size/mtime/inode, `content_hash`, media metadata (`width`, `height`,
  `duration`, `codec`, `fps`, `captured_at`), `thumb_path` / `thumb_status`, and
  `deleted_at` / `excluded_at` markers. For audio, `width` / `height` / `fps`
  stay NULL even when the file embeds cover art — the artwork's dimensions
  describe the jacket, not the track. Images keep `fps` NULL too, except
  animated ones (a GIF with more than one frame, or an APNG): ffprobe reports a
  default 25/1 for a still, which is not a property of the file. A tiled
  HEIF/AVIF (as phone cameras write) keeps `width` / `height` NULL: depending
  on the version, ffprobe reports one tile's size, 0x0, or no stream at all,
  never the full image. Its stored `meta` keeps only the first tile's stream.
- `tags` — the tag master, unique on `(namespace, name)`. An empty namespace
  means the tag is the user's own; a non-empty one means it is owned by a
  pipeline (see [Derived tags](#derived-tags)).
- `file_meta` — durable user metadata (see below).
- `meta_tags` — tag associations.
- `play_history` — playback history.
- `scene_bookmarks` — user-created scene positions.
- `settings` — a key/value store, currently holding the derived-tag ruleset
  version (see [Derived tags](#derived-tags)).
- `files_fts` — the FTS5 virtual table (see below).
- `assets` — durable Cover, Sheet, and manual-original projections keyed by
  stable `video_id`, with source priority, generation version, and lifecycle
  status. A manual asset is never overwritten by automatic regeneration.
- `asset_tasks` — retryable Cover/Sheet generation work with attempt count,
  backoff, and error code.
- `playlists` — persistent static and smart playlist definitions. Smart rules
  are normalized JSON ASTs; static membership is stored by `video_id`.
- `playlist_items` — ordered static playlist membership with foreign keys and
  cascade cleanup when a playlist or logical video is removed.

## Versioned migrations and backups

The existing DDL remains idempotent for compatibility: `CORE_DDL` uses
`CREATE TABLE IF NOT EXISTS`, and `backfillColumns()` adds missing legacy
columns safely. Phase 1 adds a checked migration registry in
`electron/core/migrations.ts` on top of that compatibility layer:

- every step has a monotonically increasing version, name, SQL text, and
  SHA-256 checksum;
- a legacy database receives a version 0 baseline after its required tables are
  checked;
- each pending step and its metadata row run in one SQLite transaction;
- an altered checksum, missing step, or failed transaction stops startup before
  a normal workspace/query handle is opened.

The first registered step creates `portable_metadata` with the layout version,
application version, and last backup ID. It does not rename or delete existing
media tables. Indexes and compatibility backfills remain in `CORE_DDL` and
`backfillColumns()` because they must also repair older databases.

The current registry is append-only through version 4: v2 adds stable video
identity/fingerprint/scan-run tables, v3 adds the asset pipeline, and v4 adds
playlists. Existing phase-2 databases therefore open through the same checksum
verified path and retain their old files and metadata.

Indexes go in `CORE_DDL` too — `openDb()` re-executes it on every open, so
`CREATE INDEX IF NOT EXISTS` reaches existing databases without any entry in
`backfillColumns()`.

The `auto_meta_ruleset_version` row in `settings` versions _derived data_, not
schema. It does not gate the migration runner; a missing or stale marker simply
causes derived tags to be rebuilt on the next scan.

Before a pending migration, `electron/core/backups.ts` creates a directory under
`Data/backups/<timestamp>-<uuid>/` containing:

```text
library.sqlite   # SQLite-consistent snapshot, including WAL state
config.json      # matching configuration snapshot
manifest.json    # sizes, SHA-256 hashes, schema version, and restore target
```

The temporary directory is validated before publication. Recovery lists only
backups whose manifest and snapshot hashes still validate. Restoring copies both
files to a temporary location, validates them again, closes active handles, and
atomically replaces the current database/configuration. The original backup is
never deleted by restore.

### Startup recovery states

`preparePortableData()` classifies startup as `ready`, `needs-initialization`,
`migration-failed`, or `restore-available`. The renderer receives only the
resolved Data directory, a stable message code, and validated backup summaries.
When the state is not ready, normal workspace IPC and query handles are not
started. The recovery page offers one primary action for the current state and
relaunches the app after a successful initialize, retry, or restore.

## Metadata and `meta_key`

User-edited metadata is split into `file_meta`, whose primary key is **not**
`files.id` but `meta_key`:

```text
meta_key = COALESCE(content_hash, 'p:<root_id>:<rel_path>')
```

`files.meta_key` is a `VIRTUAL` generated column computing the same expression.
It prefers `content_hash` and falls back to a root-scoped `rel_path` when no
hash is available. Because metadata is keyed this way, it **survives file moves,
renames, and rebuilds of the `files` / `files_fts` tables** — anything that
would change or regenerate `files.id`.

`file_meta` holds `favorite`, `rating` (0–5), `last_accessed_at`, and
`thumb_offset_sec` (the user-chosen thumbnail frame offset, `NULL` meaning the
auto-extracted representative frame).

## Derived tables

These tables are keyed by `meta_key` for the same durability reason:

- `meta_tags` — tag associations (`source`, optional `score`). `source` is
  `manual` for hand-applied tags and `auto-meta` for the metadata classifier.
- `scene_bookmarks` — user-created scene positions in a video (`sec >= 0`),
  distinct from the auto-generated evenly-spaced scenes the player shows.
- `play_history` — playback records (`played_at`, `position`, `via` =
  `browser` | `external`).

## Full-text search

`files_fts(rel_path, tags_text)` is an FTS5 virtual table whose `rowid` matches
`files.id`. It is kept in sync by `syncFts()` in `electron/core/tags.ts`; call it
after any tag change so the searchable `tags_text` stays current. For a batch of
files — a tag rename, a merge, the derived-tag backfill — use
`resyncFtsForKeys()` in `db.ts` instead, which re-indexes a whole set of
`meta_key`s in one pair of statements.

`tags_text` holds the **user's own** tag names, joined by spaces and
deduplicated across sources. Three places produce it — `syncFts()`,
`resyncFtsForKeys()` and the trigram rebuild — and they must never drift, so the
projection lives in a single `FTS_ROW_SELECT` constant in `db.ts`.

Generated tags are deliberately **not** indexed. The tokenizer is trigram, so
indexing `dur:long` would make a plain search for "long" return every long
video — and likewise for "short", "square", "h264".

Exact tag conditions instead live in the search box as the **`tag:` directive**,
which `buildSearchTerms()` in `queries/files.ts` pulls out before the FTS split
and resolves against the `tags` table:

- `tag:beach` — a user's own tag. Clicking a tag writes this into the box, so the
  condition is visible and editable without the exact match degrading into a
  substring search that also hits file names.
- `tag:4k`, `tag:long` — a generated tag; this is the only free-text route to
  them. The bare value is enough because the categories share no values (declared
  in `AUTO_META_VALUES` and pinned by a ruleset test); the qualified `tag:res:4k`
  is accepted too.

**One prefix, both kinds.** A bare value that names a manual tag _and_ a
generated one resolves to both, which is the reading a person means by `tag:4k`;
the qualified form narrows it back down. A second prefix for generated tags was
tried and removed: nobody thinks of "my tags" and "the scanner's tags" as
separate things to search, and it only bought two vocabularies to keep straight.

Values containing spaces are quoted (`tag:"beach house"`); `splitSearchTokens()`
and `joinSearchTokens()` in `shared/tags.ts` round-trip them. A space after the
colon is folded away (`tag: beach` = `tag:beach`) inside the tokenizer, so the
chip the box draws and the SQL the query produces can never disagree about it.
`tag` is a reserved manual-tag prefix, so the directive cannot be shadowed by a
tag the user creates. The structured `SearchQuery.tags[]` field still works and
is what saved searches and Discover URLs carry.

The box itself (`SearchTokenInput`) renders a directive as a **chip** rather than
as raw text, so it is added and removed as one unit: a directive only means
anything whole, and backspacing through the middle of one silently turns an exact
tag match into a substring search. A token becomes a chip once the user closes it
with a space or Enter — never mid-word — and `hasOpenQuote()` keeps a space typed
inside an unclosed `tag:"…` phrase from counting as that boundary. Free text stays
ordinary editable text, so the box remains one plain string end to end.

Focus never leaves the input — the chips are a rendering of the query string, not
widgets of their own. Once the caret runs out of text to its left, Left and
Backspace start walking back over the chips instead, highlighting one at a time;
Left/Right move the highlight, Backspace/Delete removes the highlighted chip, and
Escape, Right past the last chip, or simply typing returns to the text. Backspace
highlights before it deletes because a chip goes with no undo. Clicking a chip
highlights it too, and so does clicking a tag that is _already_ a condition:
`onTagClick` in Home compares the result of `addSearchTokens()` by reference and,
when nothing changed, sends `highlightSearchToken()` over the event bus rather
than leaving what looks like a dead click.

While a directive is being typed the box completes it from the tag catalog — the
user's own tags and the generated ones in one list, since one directive matches
both. The match is a case-insensitive substring — a tag is as often remembered by
a word in the middle of it — ranked prefix-first then by file count, and capped
at `MAX_TAG_SUGGESTIONS`. Tab or Enter accepts the highlighted candidate and
chips it; Tab preventDefaults so the caret stays put for the next condition,
while Shift+Tab still leaves the field. The candidates come from the
`tags_list_all` catalog the tag management screen already caches, filtered in the
renderer: one query instead of one per keystroke, and correct in the `All` view
and in collections, where a workspace-scoped `tags_list` cannot resolve a
database at all.

## Derived tags

Tags whose `source` is not `manual` are owned by a pipeline and are read-only to
the user: rename, merge and delete reject them, and the tag management screen
offers no affordance for them. Today the only such source is `auto-meta`, which
`electron/core/autoMetaTags.ts` derives during the scan from the ffprobe columns
already stored on `files`:

| Namespace | Applies to    | Values                                               |
| --------- | ------------- | ---------------------------------------------------- |
| `res`     | video + image | `4k` / `1080p` / `720p` / `sd`, from the longer edge |
| `dur`     | video         | `short` (<1 min) / `medium` / `long` (>30 min)       |
| `codec`   | video         | normalized `codec_name` (`h264`, `hevc`, `av1`, …)   |
| `orient`  | video + image | `vertical` / `horizontal` / `square`                 |

Application is a diff against the current `(meta_key, source)` rows, so
re-scanning an unchanged library writes nothing. Files that the scan classifies
as `unchanged` or `moved` never enter the thumbnail pool, so an existing library
is filled in by a separate chunked pass in `runScan()` (progress phase `tags`),
gated on a ruleset version recorded in the `settings` table under
`auto_meta_ruleset_version`. Bumping `AUTO_META_RULESET_VERSION` re-derives every
file on the next scan.

The set of namespaces is **not closed**. No code that decides tag _identity_ may
enumerate it: search tokens resolve against the `tags` table itself, and the tag
screen sorts unknown namespaces after the known ones rather than dropping them.

## Query layer

`electron/core/queries.ts` is a barrel that re-exports the implementations split
across `electron/core/queries/`:

- `files.ts` — `searchFiles`, `randomFiles`, `fileDetail`, and the favorite
  filter.
- `meta.ts` — metadata reads and writes.
- `bookmarks.ts` — scene bookmark operations.
- `thumbs.ts` — thumbnail-related queries.
- `scanRoots.ts` — scan-root bookkeeping.
- `assets.ts` — asset selection, lifecycle rows, and retryable task state.
- `playlists.ts` — static/smart playlist CRUD, rule evaluation queries, and
  ordered media resolution.

## External playback

M3U8 export resolves current absolute file paths at export time, skips files
that no longer exist under the workspace root, and writes UTF-8 with CRLF line
endings. The PotPlayer adapter discovers a configured or common Windows
executable and launches it with an argument array; no shell command string is
constructed. When the player is unavailable, in-app Chromium playback remains
the fallback.
