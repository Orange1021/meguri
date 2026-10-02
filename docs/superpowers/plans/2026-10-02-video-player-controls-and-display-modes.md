# Video Player Controls and Display Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three confirmed video-player improvements: replace the detail-page seek buttons with previous/next video navigation, add per-video display-mode selection with a contain default, and make fullscreen apply only to the player surface.

**Architecture:** Keep playlist navigation in `usePrevNextNavigation` and pass its callbacks into the player’s bottom control bar. Store display modes in a validated localStorage map keyed by workspace and file ID, with the player owning the selected mode for the currently displayed file. Make the player wrapper itself the Fullscreen API target and remove the detail modal’s legacy fullscreen state and top-bar navigation controls.

**Tech Stack:** React, TypeScript, Vitest, Radix UI DropdownMenu, Lucide React, Fullscreen API, browser localStorage, Electron/Vite build scripts.

---

## Task 1: Add a validated per-video display-mode store

**Files:**

- Create `src/video/videoDisplayMode.ts`.
- Create `src/video/__tests__/videoDisplayMode.test.ts`.

- [ ] Write the storage tests first. Use an in-memory `Storage` double and cover:
  - a missing entry returns `contain`;
  - a mode written for workspace A/file 1 is not returned for workspace B/file 1 or workspace A/file 2;
  - all three supported values round-trip;
  - malformed JSON, invalid modes, and non-object payloads fall back to `contain` without throwing.

  Run the focused test before implementation:

```powershell
npx vitest run --project renderer src/video/__tests__/videoDisplayMode.test.ts
```

The run must fail because the new module does not exist yet.

- [ ] Implement the store with these public contracts:

```ts
export type VideoDisplayMode = "contain" | "cover" | "fill";
export const DEFAULT_VIDEO_DISPLAY_MODE: VideoDisplayMode = "contain";
export function readVideoDisplayMode(
  workspaceId: string,
  fileId: string,
  storage?: Storage,
): VideoDisplayMode;
export function writeVideoDisplayMode(
  workspaceId: string,
  fileId: string,
  mode: VideoDisplayMode,
  storage?: Storage,
): void;
```

Use one namespaced localStorage key containing a JSON object keyed by a collision-safe workspace/file pair. Treat storage access and JSON parsing as best-effort so private browsing, malformed user data, and quota errors do not break video playback.

- [ ] Re-run the focused test and verify it passes.

## Task 2: Add player-level previous/next controls and display-mode UI

**Files:**

- Modify `src/routes/MediaDetail/VideoPlayer.tsx`.
- Modify `src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx`.

- [ ] Add failing component tests for:
  - clicking the bottom-left and bottom-right navigation buttons calls `onPrev` and `onNext` rather than changing `currentTime`;
  - unavailable directions are disabled;
  - the display-mode menu changes the video class between `object-contain`, `object-cover`, and `object-fill`;
  - the fullscreen button requests fullscreen on the player wrapper, not an ancestor supplied by the detail modal.

  Run the focused player tests and confirm the new assertions fail before changing the component:

```powershell
npx vitest run --project renderer src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx
```

- [ ] Extend `VideoPlayer` props with optional `onPrev`, `onNext`, `canPrev`, and `canNext` callbacks/state. Keep the existing keyboard bindings and `ArrowLeft`/`ArrowRight`/`J`/`L` seeking behavior unchanged. Change the two bottom seek buttons to previous/next buttons using the existing media navigation labels, disabled state, and accessible names.

- [ ] Add player-local display-mode state backed by the new store. Read the mode from the current workspace/file on mount and when either identity changes; write immediately when the user selects a new mode. Use `contain` for a new video with no saved choice. Map the mode to `object-contain`, `object-cover`, or `object-fill` without changing the player’s aspect-ratio container.

- [ ] Add a compact Radix dropdown to the bottom control bar with translated labels for the three modes. The trigger must expose an accessible label and the current mode, and menu choices must be keyboard accessible. Add an unmount cleanup that exits fullscreen if the player wrapper is removed while it is the active fullscreen element.

- [ ] Re-run the focused player tests and verify they pass.

## Task 3: Move navigation into the player and make fullscreen player-only

**Files:**

- Modify `src/routes/MediaDetail/index.tsx`.
- Modify `src/routes/MediaDetail/MediaModal.tsx`.
- Modify `src/routes/MediaDetail/useDetailPresentation.ts`.
- Modify the affected tests in `src/routes/MediaDetail/__tests__/closeTarget.test.tsx`, `playerDetourNav.test.tsx`, and `watchLaterNav.test.tsx`.

- [ ] Update integration tests first so they locate the bottom previous/next buttons after the video metadata is loaded, and assert that the current navigation context still determines the target file. Add coverage that the detail top bar no longer renders duplicate previous/next controls.

  Run the affected tests before implementation:

```powershell
npx vitest run --project renderer src/routes/MediaDetail/__tests__/closeTarget.test.tsx src/routes/MediaDetail/__tests__/playerDetourNav.test.tsx src/routes/MediaDetail/__tests__/watchLaterNav.test.tsx
```

- [ ] In `MediaDetail`, pass `goPrev`, `goNext`, `canPrev`, and `canNext` to `VideoPlayer`, remove the top-bar navigation props, and stop passing `modalRef` as a fullscreen target. Keep `navKeys` wired to the same navigation binding so keyboard seeking and item navigation remain distinct.

- [ ] In `MediaModal`/`TopBar`, remove the duplicate previous/next buttons, their Chevron imports, and the obsolete fullscreen-specific modal layout branch. Keep the close button and title/actions unchanged.

- [ ] In `useDetailPresentation`, remove the modal-level `isFullscreen` state and `useIsFullscreen` dependency. Keep the modal ref for close-target behavior, but do not let image/audio/detail transitions manage player fullscreen state.

- [ ] Make `VideoPlayer` always request fullscreen on its own wrapper. Its fullscreen layout must occupy the viewport, hide surrounding metadata by virtue of being the only fullscreen element, and prevent page/detail scrolling while active. Verify exiting fullscreen returns to the normal detail layout.

- [ ] Re-run the affected integration tests and the focused player tests.

## Task 4: Add translations and update project-facing documentation

**Files:**

- Modify `src/i18n/locales/en.ts`.
- Modify `src/i18n/locales/zh-CN.ts`.
- Modify `src/i18n/locales/ja.ts`.
- Modify `src/i18n/locales/ko.ts`.
- Modify `src/i18n/locales/fr.ts`.
- Modify `src/i18n/locales/es.ts`.
- Update the existing player-control design specification if implementation details differ from the final behavior.

- [ ] Add complete locale entries for the display-mode menu and its three choices. Keep the existing seek-shortcut strings because keyboard seeking remains supported even though the seek buttons are gone.

- [ ] Run the locale/type-focused renderer tests and typecheck to catch missing keys or inconsistent locale shapes:

```powershell
npx vitest run --project renderer src/i18n
npm run typecheck
```

## Task 5: Full verification, portable packaging, and remote update

- [ ] Run the focused test suites again, then the complete project verification:

```powershell
npx vitest run --project renderer src/video/__tests__/videoDisplayMode.test.ts src/routes/MediaDetail/__tests__/VideoPlayer.test.tsx src/routes/MediaDetail/__tests__/closeTarget.test.tsx src/routes/MediaDetail/__tests__/playerDetourNav.test.tsx src/routes/MediaDetail/__tests__/watchLaterNav.test.tsx
npm test
npm run typecheck
npm run format:check
```

Record any pre-existing unrelated check failure separately; do not weaken assertions or hide failures.

- [ ] Build the portable package with `npm run dist:portable`. Confirm the final `橙映` directory still contains only the executable plus the user-managed `Data` and `Media` directories, and confirm those data directories remain ignored by Git.

- [ ] Run the packaged-app startup smoke test and inspect the final Git diff. Stage only source, test, documentation, and translation files; never stage `Data`, `Media`, `橙映`, or generated release output.

- [ ] Commit the implementation on `main` and push `main` to `origin`, then report the commit and verification results.
