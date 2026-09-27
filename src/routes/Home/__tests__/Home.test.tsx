import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import "@/test/mockVirtualizer";
import Home from "@/routes/Home";
import MediaDetail from "@/routes/MediaDetail";
import {
  defaultAppStatus,
  defaultWorkspacesList,
  sampleFileDetail,
  sampleFileRow,
  sampleTags,
  WS_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";
import { applyTagFilter } from "@/lib/ui-events";
import { useMediaNav, usePlaylistNav } from "@/components/MediaNavContext";
import { getListCounts } from "@/hooks/useListCounts";
import { BY_FOLDER_KEY, VIEW_KEY } from "@/routes/Home/utils";

const mocks = vi.hoisted(() => ({
  appStatus: vi.fn(),
  workspacesList: vi.fn(),
  filesSearch: vi.fn(),
  fileGet: vi.fn(),
  fileSetFavorite: vi.fn(),
  fileSetRating: vi.fn(),
  fileRecordPlay: vi.fn(),
  scanStart: vi.fn(),
  workspaceStats: vi.fn(),
  foldersList: vi.fn<(ws: string, path: string) => Promise<unknown>>(),
  folderFiles: vi.fn<(ws: string, paths: string[]) => Promise<unknown>>(),
  folderOpenInFileManager:
    vi.fn<(ws: string, path: string) => Promise<unknown>>(),
  folderCopyPath: vi.fn<(ws: string, path: string) => Promise<unknown>>(),
}));

// Toasts are asserted on the call: no Toaster is mounted in these tests.
const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), toasts),
  Toaster: () => null,
}));

vi.mock("@/ipc/client", () => ({
  api: {
    appStatus: () => mocks.appStatus(),
    workspacesList: () => mocks.workspacesList(),
    filesSearch: (query: unknown) => mocks.filesSearch(query),
    fileGet: (id: number, ws: string) => mocks.fileGet(id, ws),
    fileSetFavorite: (...args: unknown[]) => mocks.fileSetFavorite(...args),
    fileSetRating: (...args: unknown[]) => mocks.fileSetRating(...args),
    fileRecordPlay: (...args: unknown[]) => mocks.fileRecordPlay(...args),
    scanStart: (...args: unknown[]) => mocks.scanStart(...args),
    workspaceStats: () => mocks.workspaceStats(),
    foldersList: (ws: string, path: string) => mocks.foldersList(ws, path),
    folderFiles: (ws: string, paths: string[]) => mocks.folderFiles(ws, paths),
    folderOpenInFileManager: (ws: string, path: string) =>
      mocks.folderOpenInFileManager(ws, path),
    folderCopyPath: (ws: string, path: string) =>
      mocks.folderCopyPath(ws, path),
    tagsList: vi.fn().mockResolvedValue([]),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn().mockResolvedValue(undefined),
    copyFilePath: vi.fn().mockResolvedValue(undefined),
    bookmarkAdd: vi.fn().mockResolvedValue(null),
    bookmarkRemove: vi.fn().mockResolvedValue(undefined),
    thumbSetOffset: vi.fn().mockResolvedValue({ thumbOffsetSec: null }),
    fileAddTag: vi.fn().mockResolvedValue(undefined),
    fileRemoveTag: vi.fn().mockResolvedValue(undefined),
    fileDeleteFromIndex: vi.fn().mockResolvedValue({ id: 1 }),
    collectionAddFile: vi.fn().mockResolvedValue(undefined),
    collectionRemoveFile: vi.fn().mockResolvedValue(undefined),
  },
  events: {
    onThumbDone: vi.fn().mockResolvedValue(() => {}),
    onScanDone: vi.fn().mockResolvedValue(() => {}),
    onScanProgress: vi.fn().mockResolvedValue(() => {}),
    onWorkspaceChanged: vi.fn().mockResolvedValue(() => {}),
  },
  ALL_ID: "__all__",
  COLLECTION_ID_PREFIX: "collection:",
  collectionTarget: (id: string) => `collection:${id}`,
}));

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />}>
        <Route path="file/:id" element={<MediaDetail />} />
        <Route path="play" element={<PlaylistProbe />} />
      </Route>
    </Routes>
  );
}

/** Stands in for the player: shows the order it would play. */
function PlaylistProbe() {
  const playlist = usePlaylistNav();
  const list = useMediaNav();
  const nav = playlist ?? list;
  return (
    <div data-testid="playlist-probe">
      {playlist ? "own:" : "list:"}
      {nav?.items.map((f) => f.relPath).join(",")}
    </div>
  );
}

describe("Home + MediaDetail integration", () => {
  beforeEach(() => {
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.fileGet.mockResolvedValue(sampleFileDetail);
    mocks.fileSetFavorite.mockResolvedValue(undefined);
    mocks.fileSetRating.mockResolvedValue(undefined);
    mocks.fileRecordPlay.mockResolvedValue(undefined);
    mocks.scanStart.mockResolvedValue(null);
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("lists files on Home and opens MediaDetail from a grid link", async () => {
    renderWithProviders(<AppRoutes />);

    await waitFor(() => {
      expect(screen.getByText("sample.mp4")).toBeTruthy();
    });

    // Click the grid tile's link specifically (the header also contains links).
    fireEvent.click(screen.getByText("sample.mp4").closest("a")!);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(mocks.fileGet).toHaveBeenCalledWith(1, WS_ID);
  });

  it("toggles favorite from MediaDetail and patches react-query caches", async () => {
    const { queryClient } = renderWithProviders(<AppRoutes />, {
      route: `/file/1?ws=${WS_ID}`,
    });

    queryClient.setQueryData(["files_search", WS_ID, {}], {
      pages: [{ items: [{ ...sampleFileRow, favorite: 0 }], nextCursor: null }],
      pageParams: [undefined],
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });

    const favBtn = within(screen.getByRole("dialog")).getByRole("button", {
      name: "Add to favorites",
    });
    fireEvent.click(favBtn);

    await waitFor(() =>
      expect(mocks.fileSetFavorite).toHaveBeenCalledWith(1, WS_ID, true),
    );

    const search = queryClient.getQueryData<{
      pages: { items: { favorite: number }[] }[];
    }>(["files_search", WS_ID, {}]);
    expect(search?.pages[0].items[0].favorite).toBe(1);
  });

  describe("tag chips", () => {
    beforeEach(() => {
      mocks.filesSearch.mockResolvedValue({
        items: [{ ...sampleFileRow, tags: sampleTags }],
        nextCursor: null,
      });
    });

    /** The most recent files_search query the component issued. */
    function lastQuery(): Record<string, unknown> {
      const calls = mocks.filesSearch.mock.calls;
      return calls[calls.length - 1][0] as Record<string, unknown>;
    }

    it("hides auto-meta tags from the cards but keeps manual ones", async () => {
      renderWithProviders(<AppRoutes />);
      await waitFor(() => expect(screen.getByText("beach")).toBeTruthy());
      // The metadata classifier emits several tags per file; they would crowd out
      // the manual ones in the card's single scrolling chip row.
      expect(screen.queryByText("res:")).toBeNull();
    });

    it("hides by source, not by namespace", async () => {
      mocks.filesSearch.mockResolvedValue({
        items: [
          {
            ...sampleFileRow,
            tags: [
              ...sampleTags,
              {
                id: 12,
                name: "a24",
                namespace: "studio",
                source: "auto-name",
                score: null,
              },
            ],
          },
        ],
        nextCursor: null,
      });
      renderWithProviders(<AppRoutes />);
      // A namespaced tag from a source that is not in LIST_HIDDEN_SOURCES still
      // renders — hiding is about the source's verbosity, not the namespace.
      expect(await screen.findByText("a24")).toBeTruthy();
      expect(screen.getByText("studio:")).toBeTruthy();
      expect(screen.queryByText("res:")).toBeNull();
    });

    it("puts an exact-tag directive in the search box, not the bare word", async () => {
      renderWithProviders(<AppRoutes />);
      await waitFor(() => expect(screen.getByText("beach")).toBeTruthy());

      fireEvent.click(screen.getByText("beach"));

      // The condition is exact — a bare "beach" would also hit files merely
      // named that — and it is visible in the search box, as a chip rather than
      // as raw text the user could break in half.
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
      const input = document.getElementById(
        "list-search-input",
      ) as HTMLInputElement;
      expect(
        within(input.parentElement!).getByTitle("Tags: beach"),
      ).toBeTruthy();
      expect(input.value).toBe("");
    });

    it("does not duplicate a condition when the same tag is clicked twice", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));

      // The chip re-renders once the refetch settles; clicking it again is a no-op.
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() => expect(lastQuery().q).toBe("tag:beach"));
    });

    it("points at the existing chip when the tag is already a condition", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));
      const chip = await screen.findByTitle("Tags: beach");
      expect(chip.dataset.selected).toBeUndefined();

      // A second click adds nothing, so without this it reads as a dead click.
      fireEvent.click(await screen.findByText("beach"));
      await waitFor(() =>
        expect(
          document
            .querySelector('[data-slot="search-chip"]')
            ?.getAttribute("data-selected"),
        ).toBe("true"),
      );
      expect(lastQuery().q).toBe("tag:beach");
    });

    it("removes the directive as a whole from the search box", async () => {
      renderWithProviders(<AppRoutes />);
      fireEvent.click(await screen.findByText("beach"));

      // A directive only means anything whole, so it is removed whole — one
      // click, no half-deleted `tag:bea` left behind as a substring search.
      const chip = await screen.findByTitle("Tags: beach");
      fireEvent.click(within(chip).getByRole("button"));

      await waitFor(() => expect(lastQuery().q).toBeUndefined());
    });
  });

  it("filters the library from a tag in the detail view", async () => {
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, tags: sampleTags });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    // The detail pane is the one place generated tags are visible, so it is also
    // where they can be clicked.
    fireEvent.click(await screen.findByText("4k"));

    await waitFor(() => {
      const calls = mocks.filesSearch.mock.calls;
      // The bare value: category vocabularies are disjoint, so `tag:4k` is
      // unambiguous and reads better than `tag:res:4k`.
      expect((calls[calls.length - 1][0] as Record<string, unknown>).q).toBe(
        "tag:4k",
      );
    });
    // Filtering only makes sense with the library visible, so the modal closes.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("filters by a manual tag from the detail view", async () => {
    mocks.fileGet.mockResolvedValue({ ...sampleFileDetail, tags: sampleTags });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    fireEvent.click(await screen.findByText("beach"));

    await waitFor(() => {
      const last = mocks.filesSearch.mock.calls.at(-1)![0] as Record<
        string,
        unknown
      >;
      expect(last.q).toBe("tag:beach");
    });
  });

  // FR-014: the detail screen's existing collection dropdown lists all collections,
  // so the seeded Watch Later shows up there alongside user collections with no
  // extra wiring. Locked in here so a future filter can't silently drop it.
  it("lists Watch Later in the detail view's collection menu", async () => {
    mocks.workspacesList.mockResolvedValue({
      ...defaultWorkspacesList,
      collections: [
        {
          id: "watch-later",
          name: "Watch Later",
          emoji: "🕒",
          active: false,
          items: [],
          createdAt: 0,
          updatedAt: 0,
          locked: true,
        },
      ],
    });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    fireEvent.pointerDown(await screen.findByLabelText("Add to collection"), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });

    expect(await screen.findByText('Add to "Watch Later"')).toBeTruthy();
  });

  // Watch Later removal rides on "a play was recorded" (see
  // Workspaces.removeFromWatchLater in electron/core/workspaces.ts). Merely
  // opening a video's detail must not record one, or
  // queueing something and peeking at its metadata would silently consume it.
  it("does not record a play when only opening a video detail", async () => {
    renderWithProviders(<AppRoutes />, {
      route: `/file/1?ws=${WS_ID}&autoplay=0`,
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "sample.mp4" })).toBeTruthy();
    });
    expect(mocks.fileRecordPlay).not.toHaveBeenCalled();
  });

  it("records a play when opening an image detail", async () => {
    mocks.fileGet.mockResolvedValue({
      ...sampleFileDetail,
      kind: "image",
      relPath: "photos/pic.jpg",
      ext: "jpg",
      duration: null,
    });
    renderWithProviders(<AppRoutes />, { route: `/file/1?ws=${WS_ID}` });

    await waitFor(() =>
      expect(mocks.fileRecordPlay).toHaveBeenCalledWith(1, WS_ID, "browser"),
    );
    // A single visit records exactly once despite refetches/re-renders.
    expect(mocks.fileRecordPlay).toHaveBeenCalledTimes(1);
  });
});

describe("Home folder view", () => {
  const movie = {
    name: "Movie",
    path: "Movie",
    count: 3,
    subfolders: 1,
    previews: [sampleFileRow],
  };
  const lastSearch = () => {
    const calls = mocks.filesSearch.mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  };

  afterEach(() => {
    localStorage.removeItem(VIEW_KEY);
    localStorage.removeItem(BY_FOLDER_KEY);
  });

  beforeEach(() => {
    localStorage.setItem(VIEW_KEY, "grid");
    localStorage.setItem(BY_FOLDER_KEY, "true");
    mocks.appStatus.mockResolvedValue(defaultAppStatus);
    mocks.workspacesList.mockResolvedValue(defaultWorkspacesList);
    mocks.filesSearch.mockReset();
    mocks.filesSearch.mockResolvedValue({
      items: [sampleFileRow],
      nextCursor: null,
    });
    mocks.foldersList.mockReset();
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      Promise.resolve({
        path,
        folders: path === "" ? [movie] : [],
        fileCount: 1,
      }),
    );
    mocks.workspaceStats.mockResolvedValue({ fileCount: 1, lastScanAt: null });
  });

  it("lists the root's folders and direct files, then walks into a folder", async () => {
    renderWithProviders(<AppRoutes />);

    await screen.findByTestId("folder-card");
    expect(lastSearch().folder).toEqual({ path: "", recursive: false });
    expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "");
    // The header says what the folder holds: one folder, one direct file.
    expect(await screen.findByText("Folders: 1 · Files: 1")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );

    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );
    const crumbs = screen.getByRole("navigation", { name: "Folder path" });
    expect(within(crumbs).getByText("Movie").getAttribute("aria-current")).toBe(
      "page",
    );

    // Back up through the breadcrumb.
    fireEvent.click(within(crumbs).getByRole("button", { name: "Media" }));
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
  });

  it("searches everything below the folder, without its folder cards", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");

    applyTagFilter(["tag:beach"]);

    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: true }),
    );
    await waitFor(() => expect(screen.queryByTestId("folder-card")).toBeNull());
    expect(
      screen.getByRole("navigation", { name: "Folder path" }),
    ).toBeTruthy();
  });

  it("moves up when the folder shown has gone away", async () => {
    mocks.foldersList.mockImplementation((_ws: string, path: string) =>
      Promise.resolve({
        path: path === "Movie" ? "" : path,
        folders: path === "" ? [movie] : [],
        fileCount: 1,
      }),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );

    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "", recursive: false }),
    );
  });

  it("draws the grid flat over All without forgetting the folder option", async () => {
    mocks.appStatus.mockResolvedValue({
      ...defaultAppStatus,
      root: "All",
      workspaceId: "__all__",
    });
    renderWithProviders(<AppRoutes />);

    await screen.findByText("sample.mp4");
    expect(lastSearch().folder).toBeUndefined();
    expect(mocks.foldersList).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Show by folder" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen
        .getByRole("button", { name: "Grid view" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("true");
  });

  it("drops a grid selection when turning on the folder option at the root", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    const name = await screen.findByText("sample.mp4");
    fireEvent.click(name.closest("a")!, { ctrlKey: true });
    expect(
      screen.getByRole("region", { name: "Selection actions" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show by folder" }));

    await screen.findByTestId("folder-card");
    expect(
      screen.queryByRole("region", { name: "Selection actions" }),
    ).toBeNull();
  });

  it("opens the folder shown in the file manager", async () => {
    mocks.folderOpenInFileManager.mockResolvedValue(undefined);
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenCalledWith(WS_ID, "Movie"),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open in file manager" }),
    );
    expect(mocks.folderOpenInFileManager).toHaveBeenCalledWith(WS_ID, "Movie");
  });

  it("says so when the folder cannot be opened", async () => {
    mocks.folderOpenInFileManager.mockRejectedValue(
      new Error("folder not found"),
    );
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(
      screen.getByRole("button", { name: "Open in file manager" }),
    );
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't open the folder",
        expect.objectContaining({ description: "folder not found" }),
      ),
    );
  });

  it("copies the folder's path and says so", async () => {
    mocks.folderCopyPath.mockResolvedValue(undefined);
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    fireEvent.click(screen.getByRole("button", { name: "Copy path" }));
    expect(mocks.folderCopyPath).toHaveBeenCalledWith(WS_ID, "");
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith(
        "Copied the folder path",
        expect.anything(),
      ),
    );
  });

  it("draws the list by folder too, and keeps the option across views", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    renderWithProviders(<AppRoutes />);

    // Folder rows ahead of the direct files, opened like the cards.
    await screen.findByTestId("folder-row");
    expect(lastSearch().folder).toEqual({ path: "", recursive: false });
    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(lastSearch().folder).toEqual({ path: "Movie", recursive: false }),
    );

    // One option for both views: the grid opens by folder, in the same place.
    fireEvent.click(screen.getByRole("button", { name: "Grid view" }));
    await waitFor(() =>
      expect(mocks.foldersList).toHaveBeenLastCalledWith(WS_ID, "Movie"),
    );
    expect(
      screen
        .getByRole("button", { name: "Show by folder" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("toggles the option from the command menu, in the view shown", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    localStorage.setItem(BY_FOLDER_KEY, "false");
    // cmdk scrolls the highlighted option into view; jsdom has no layout.
    if (!("scrollIntoView" in Element.prototype)) {
      Object.defineProperty(Element.prototype, "scrollIntoView", {
        configurable: true,
        value: () => {},
      });
    }
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");

    const run = async (name: string) => {
      fireEvent.keyDown(window, { key: "k", code: "KeyK", ctrlKey: true });
      fireEvent.click(await screen.findByRole("option", { name }));
    };

    // From the list: the list itself is drawn by folder.
    await run("Show by folder");
    await screen.findByTestId("folder-row");
    expect(localStorage.getItem(VIEW_KEY)).toBe("list");

    // Now on, the same command is named for undoing it.
    await run("Stop showing by folder");
    await waitFor(() => expect(screen.queryByTestId("folder-row")).toBeNull());
    expect(localStorage.getItem(BY_FOLDER_KEY)).toBe("false");
  });

  it("opens Discovery scoped to the folder shown", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    const discover = () =>
      screen.getByRole("link", { name: "Discovery" }).getAttribute("href") ??
      "";
    // At the root the pool is the whole workspace; the root is named anyway
    // so Discovery can say which folder it draws from.
    expect(decodeURIComponent(discover())).toContain(
      '"folder":{"path":"","recursive":true}',
    );

    fireEvent.click(
      screen.getByRole("button", { name: 'Open folder "Movie"' }),
    );
    await waitFor(() =>
      expect(decodeURIComponent(discover())).toContain(
        '"folder":{"path":"Movie","recursive":true}',
      ),
    );
  });

  it("publishes what the view shows for the status bar", async () => {
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    // Browsing: the folder's own files and folders (the mocked listing has
    // one direct file and one child folder at the root).
    await waitFor(() =>
      expect(getListCounts()).toEqual({ files: 1, more: false, folders: 1 }),
    );

    // Searching inside it: the files loaded so far, no folders.
    applyTagFilter(["tag:beach"]);
    await waitFor(() =>
      expect(getListCounts()).toEqual({ files: 1, more: false, folders: null }),
    );
  });

  it("leaves the count to the total when nothing narrows a flat view", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />);
    await screen.findByText("sample.mp4");
    await waitFor(() =>
      expect(getListCounts()).toEqual({
        files: null,
        more: false,
        folders: null,
      }),
    );
  });

  const fab = (name: string) =>
    screen.getByRole("link", { name }).getAttribute("aria-disabled");

  it("enables both buttons for a folder of folders, playing the whole folder", async () => {
    // The root holds no files of its own, only a folder with three.
    mocks.filesSearch.mockImplementation((query: unknown) =>
      Promise.resolve({
        // The playlist's order is the root's whole subtree, by name. The list
        // itself asks for the root's direct files (not recursive).
        items: (query as { folder?: { recursive?: boolean } }).folder?.recursive
          ? [
              { ...sampleFileRow, id: 7, relPath: "Movie/a.mp4" },
              { ...sampleFileRow, id: 8, relPath: "Movie/b.mp4" },
            ]
          : [],
        nextCursor: null,
      }),
    );
    mocks.foldersList.mockResolvedValue({
      path: "",
      folders: [movie],
      fileCount: 0,
    });
    renderWithProviders(<AppRoutes />);
    await screen.findByTestId("folder-card");
    await waitFor(() => expect(fab("Play as playlist")).toBe("false"));
    expect(fab("Discovery")).toBe("false");

    fireEvent.click(screen.getByRole("link", { name: "Play as playlist" }));
    await waitFor(() =>
      expect(screen.getByTestId("playlist-probe").textContent).toBe(
        "own:Movie/a.mp4,Movie/b.mp4",
      ),
    );
    expect(lastSearch()).toMatchObject({
      folder: { path: "", recursive: true },
      sort: "name",
      sortDir: "asc",
    });
  });

  it("disables both buttons when there is nothing to draw from", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    mocks.filesSearch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithProviders(<AppRoutes />);
    await waitFor(() => expect(mocks.filesSearch).toHaveBeenCalled());
    await waitFor(() => expect(fab("Play as playlist")).toBe("true"));
    expect(fab("Discovery")).toBe("true");
  });

  it("plays the list as shown when not browsing by folder", async () => {
    localStorage.setItem(BY_FOLDER_KEY, "false");
    renderWithProviders(<AppRoutes />, { route: "/play" });
    await waitFor(() =>
      expect(screen.getByTestId("playlist-probe").textContent).toBe(
        "list:videos/sample.mp4",
      ),
    );
  });
});
