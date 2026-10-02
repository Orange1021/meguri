# Video Cover Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate cover-preview control to each eligible video row without changing the row's existing playback behavior.

**Architecture:** Keep the existing thumbnail link and row navigation intact. Add a small controlled `CoverPreviewButton` beside the thumbnail link, lift the selected cover into `MediaList`, and render one `CoverPreviewDialog` at list level. The list computes the existing versioned thumbnail URL only for videos with a recorded thumbnail, so no new asset or backend endpoint is required.

**Tech Stack:** React 19, TypeScript, React Testing Library, Vitest, Radix Dialog wrapper, Tailwind utility classes, existing i18n catalogs and thumbnail URL helpers.

**Status:** Complete and merged to `main`. The delivered implementation also
includes bounded zoom/pan in `CoverPreviewDialog`, pointer-capture cleanup, and
keyboard controls for zooming and panning. The final Windows portable output is
generated locally at `橙映/橙映.exe`; `橙映/Data/` and `橙映/Media/` remain
intentionally ignored by Git.

---

### Task 1: Add failing component and list interaction tests

**Files:**

- Create: `src/components/__tests__/CoverPreviewButton.test.tsx`
- Create: `src/components/__tests__/CoverPreviewDialog.test.tsx`
- Modify: `src/components/__tests__/MediaListFolders.test.tsx`

- [x] **Step 1: Write the failing button event-isolation test**

Create a test that renders a parent click handler around the wished-for `CoverPreviewButton`, clicks the button by its translated accessible name, and asserts that the preview callback ran while the parent callback did not.

```tsx
it("opens preview without bubbling into the row playback target", () => {
  const onPreview = vi.fn();
  const onRow = vi.fn();
  renderWithProviders(
    <div onClick={onRow}>
      <CoverPreviewButton onClick={onPreview} />
    </div>,
  );

  fireEvent.click(screen.getByRole("button", { name: "View cover" }));

  expect(onPreview).toHaveBeenCalledOnce();
  expect(onRow).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Write the failing dialog tests**

Render the wished-for controlled dialog with a URL and title. Assert that the dialog title and image are present, then dispatch an image error and assert the explicit failure message. Add a second test that verifies closing through `onOpenChange(false)` is wired to the Dialog root.

```tsx
it("shows the selected cover and reports an image load failure", () => {
  const { container } = renderWithProviders(
    <CoverPreviewDialog
      open
      coverUrl="http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2"
      title="videos/sample.mp4"
      onOpenChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("videos/sample.mp4")).toBeTruthy();
  const image = container.querySelector('img[alt="videos/sample.mp4"]');
  expect(image?.getAttribute("src")).toContain("/thumb/1?v=2");

  fireEvent.error(image!);
  expect(screen.getByText("Could not load the cover preview")).toBeTruthy();
});
```

- [x] **Step 3: Add the failing MediaList integration tests**

Extend the existing `renderList` helper and add tests that:

1. A video with `hasThumb: 1` renders exactly one `View cover` button and clicking it opens a dialog with the versioned `/thumb/1?v=3` URL.
2. A video with `hasThumb: 0` and an audio row render no `View cover` button.

The first test must use `fireEvent.click` on the button and assert the dialog, which proves the button is usable inside the real virtualized list row without relying on a mock-only callback.

- [x] **Step 4: Run the focused tests and confirm the expected RED state**

Run:

```powershell
npm run test:renderer -- src/components/__tests__/CoverPreviewButton.test.tsx src/components/__tests__/CoverPreviewDialog.test.tsx src/components/__tests__/MediaListFolders.test.tsx
```

Expected result: the run fails because the new components and list button do not exist yet. Fix only test setup errors; do not add production implementation before the intended missing-feature failures are visible.

### Task 2: Add localized, reusable preview controls

**Files:**

- Create: `src/components/CoverPreviewButton.tsx`
- Create: `src/components/CoverPreviewDialog.tsx`
- Modify: `src/i18n/locales/ja.ts`
- Modify: `src/i18n/locales/en.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/ko.ts`
- Modify: `src/i18n/locales/es.ts`
- Modify: `src/i18n/locales/fr.ts`

- [x] **Step 1: Add the translation keys to the base catalog and every locale**

Add these keys near the existing media cover strings in `ja.ts`, then provide the corresponding translations in every catalog so the `Record<TranslationKey, string>` type remains exact:

```ts
"media.coverView": "View cover",
"media.coverPreviewTitle": "Cover preview: {name}",
"media.coverPreviewFailed": "Could not load the cover preview",
```

Use the existing product language style for Simplified Chinese (`查看封面`, `封面预览：{name}`, `封面加载失败`) and natural equivalents for Japanese, Korean, Spanish and French.

- [x] **Step 2: Implement the isolated button**

Implement `CoverPreviewButton` with a `Button`/`Eye` icon, `type="button"`, the localized `aria-label` and `title`, and an `onClick` wrapper that calls `preventDefault`, `stopPropagation`, then the supplied callback. Use a dark translucent background and a focus-visible ring so it remains legible over bright and dark frames.

- [x] **Step 3: Implement the controlled dialog**

Implement `CoverPreviewDialog` using the existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` and `DialogDescription` wrappers. The dialog should:

- accept `{ open, onOpenChange, coverUrl, title }`;
- reset its local `failedUrl` state whenever `coverUrl` changes;
- render the image with `alt={title}`, `object-contain`, and a bounded viewport;
- isolate Ctrl+wheel zoom from the window, support bounded pointer dragging after
  zoom, clean up pointer capture loss/cancellation, and expose keyboard zoom/pan;
- show the localized failure message when `onError` fires;
- keep the existing Dialog close button, overlay close, and Escape behavior.

- [x] **Step 4: Run the component tests and confirm GREEN**

Run:

```powershell
npm run test:renderer -- src/components/__tests__/CoverPreviewButton.test.tsx src/components/__tests__/CoverPreviewDialog.test.tsx
```

Expected result: all button and dialog tests pass.

### Task 3: Integrate the button and dialog into the video list

**Files:**

- Modify: `src/components/MediaList.tsx`
- Modify: `src/components/__tests__/MediaListFolders.test.tsx`

- [x] **Step 1: Compute the existing video cover URL at list-row level**

Import `hasThumbFile` and `thumbUrl`. In `MediaRow`, compute:

```ts
const coverUrl =
  file.kind === "video" && hasThumbFile(file)
    ? thumbUrl(mediaBase, file.workspaceId, file.id, version)
    : null;
```

Do not use the original media URL for this control: the requested cover is the current video main thumbnail, including a manually selected cover.

- [x] **Step 2: Add the controlled preview state to `MediaList`**

Add `useState<{ url: string; title: string } | null>(null)` at list level. Pass a stable `onViewCover` callback into `MediaRow`, and render one `CoverPreviewDialog` after the list provider. Closing the dialog sets the selected preview to `null`.

- [x] **Step 3: Place the button outside the playback Link**

Keep the existing thumbnail `Link` unchanged. Inside the thumbnail's `relative` wrapper, render `CoverPreviewButton` as a sibling after the Link when `coverUrl` exists, positioned `absolute right-1 top-1 z-20`. Its callback stores the URL and `file.relPath` in the list state. Because the button is outside the Link and also stops propagation, clicking it cannot activate playback; every other existing target remains untouched.

- [x] **Step 4: Run the list integration tests and confirm GREEN**

Run:

```powershell
npm run test:renderer -- src/components/__tests__/MediaListFolders.test.tsx
```

Expected result: the video row opens the preview dialog with the versioned thumbnail URL; rows without video covers do not render the button; all existing folder-row tests remain green.

### Task 4: Verify, package, and integrate

**Files:**

- Verify only: all changed source/test files and generated ignored portable output.

- [x] **Step 1: Run formatting and type checks**

Run:

```powershell
npx prettier --check src/components/CoverPreviewButton.tsx src/components/CoverPreviewDialog.tsx src/components/MediaList.tsx src/components/__tests__/CoverPreviewButton.test.tsx src/components/__tests__/CoverPreviewDialog.test.tsx src/components/__tests__/MediaListFolders.test.tsx src/i18n/locales/*.ts
npm run typecheck
```

Expected result: Prettier reports all files matched and all three TypeScript projects exit 0.

- [x] **Step 2: Run the complete automated suite**

Run `npm test`. Expected result: core, renderer and portable-upgrade projects all pass, including the new cover-preview tests.

- [x] **Step 3: Build and smoke-test the portable executable**

Run `npm run dist:portable`, then start only `D:\Projects\PortableVideoLibrary\橙映\橙映.exe` with `--no-sandbox --disable-gpu`, verify a responsive process whose executable path is under that D drive directory, and stop only the process started for the smoke test. Do not touch the user's existing `E:\橙映` process or its `Data`/`Media`.

- [x] **Step 4: Confirm the Git boundary and commit**

Run `git diff --check`, `git status --short --branch`, and `git check-ignore -v -- '橙映/Data' '橙映/Media' '橙映/橙映.exe' '.portable-build'`. Stage only the design/plan, source, tests and locale files. Commit with:

```powershell
git commit -m "feat: add video cover preview"
```

- [x] **Step 5: Push the approved change**

Run `git push origin main`, then verify `git ls-remote origin refs/heads/main` matches the new commit and the worktree is clean. Report the commit, verification results and the new portable executable path.
