import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { FolderHeader } from "@/components/FolderHeader";
import { renderWithProviders } from "@/test/renderWithProviders";

const foldersList = vi.hoisted(() =>
  vi.fn<(ws: string, path: string) => Promise<unknown>>(),
);
vi.mock("@/ipc/client", () => ({
  api: {
    foldersList: (ws: string, path: string) => foldersList(ws, path),
  },
}));

function render(path: string) {
  const onNavigate = vi.fn();
  const onBack = vi.fn();
  const onUp = vi.fn();
  const onOpen = vi.fn();
  const onCopy = vi.fn();
  renderWithProviders(
    <FolderHeader
      rootLabel="Videos"
      path={path}
      onNavigate={onNavigate}
      canGoBack={path !== ""}
      onBack={onBack}
      onUp={onUp}
      onOpenInFileManager={onOpen}
      onCopyPath={onCopy}
    />,
  );
  return {
    onNavigate,
    onBack,
    onUp,
    onOpen,
    onCopy,
    nav: screen.getByRole("navigation"),
  };
}

describe("FolderHeader", () => {
  it("shows only the root, as the current level, at the root", () => {
    const { nav } = render("");
    // Nothing to go back or up to, and no level to link: only the buttons
    // that reach the folder outside the app are live.
    expect(
      within(nav)
        .queryAllByRole("button")
        .filter((b) => !(b as HTMLButtonElement).disabled)
        .map((b) => b.textContent),
    ).toEqual(["Open in file manager", "Copy path"]);
    expect(within(nav).getByText("Videos").getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("links every level above the current one", () => {
    const { nav, onNavigate } = render("Movie/2024");
    fireEvent.click(within(nav).getByRole("button", { name: "Videos" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Movie" }));
    expect(onNavigate.mock.calls).toEqual([[""], ["Movie"]]);
    expect(within(nav).getByText("2024").getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("folds the middle of a deep path into a menu that still reaches it", () => {
    const { nav, onNavigate } = render("a/b/c/d/e");
    // Root, then the last two levels stay visible.
    expect(within(nav).getByRole("button", { name: "Videos" })).toBeTruthy();
    expect(within(nav).getByRole("button", { name: "d" })).toBeTruthy();
    expect(within(nav).queryByRole("button", { name: "b" })).toBeNull();

    const more = within(nav).getByRole("button", {
      name: "Show hidden levels",
    });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("menuitem", { name: "b" }));
    expect(onNavigate).toHaveBeenCalledWith("a/b");
  });

  it("offers back and up, up only below the root", () => {
    const { nav, onBack, onUp } = render("Movie");
    fireEvent.click(within(nav).getByRole("button", { name: "Back" }));
    fireEvent.click(within(nav).getByRole("button", { name: "Up one level" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it("shows what the folder holds when told", () => {
    const onNavigate = vi.fn();
    renderWithProviders(
      <FolderHeader
        rootLabel="Videos"
        path="Movie"
        onNavigate={onNavigate}
        canGoBack={false}
        onBack={() => {}}
        onUp={() => {}}
        onOpenInFileManager={() => {}}
        onCopyPath={() => {}}
        summary="7 folders · 8 files"
      />,
    );
    expect(screen.getByText("7 folders · 8 files")).toBeTruthy();
  });

  it("opens the folder in the file manager", () => {
    const { nav, onOpen } = render("Movie");
    fireEvent.click(
      within(nav).getByRole("button", { name: "Open in file manager" }),
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("copies the folder's path", () => {
    const { nav, onCopy } = render("Movie");
    fireEvent.click(within(nav).getByRole("button", { name: "Copy path" }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  describe("subfolder menu", () => {
    function renderMenu(path: string) {
      const onNavigate = vi.fn();
      renderWithProviders(
        <FolderHeader
          workspaceId="ws1"
          rootLabel="Videos"
          path={path}
          onNavigate={onNavigate}
          canGoBack={false}
          onBack={() => {}}
          onUp={() => {}}
          onOpenInFileManager={() => {}}
          onCopyPath={() => {}}
        />,
      );
      return onNavigate;
    }

    it("lists the folder's child folders and opens one", async () => {
      foldersList.mockResolvedValue({
        path: "Movie",
        folders: [
          {
            name: "2024",
            path: "Movie/2024",
            count: 3,
            subfolders: 0,
            previews: [],
          },
        ],
        fileCount: 1,
      });
      const onNavigate = renderMenu("Movie");
      const trigger = screen.getByRole("button", {
        name: 'Subfolders of "Movie"',
      });
      // Still marked as the level shown.
      expect(
        within(trigger).getByText("Movie").getAttribute("aria-current"),
      ).toBe("page");
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

      fireEvent.click(await screen.findByRole("menuitem", { name: /2024/ }));
      expect(foldersList).toHaveBeenCalledWith("ws1", "Movie");
      expect(onNavigate).toHaveBeenCalledWith("Movie/2024");
    });

    it("says so when the folder has no child folders", async () => {
      foldersList.mockResolvedValue({ path: "", folders: [], fileCount: 2 });
      renderMenu("");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: 'Subfolders of "Videos"' }),
        { button: 0, ctrlKey: false },
      );
      expect(
        await screen.findByRole("menuitem", { name: "No subfolders" }),
      ).toBeTruthy();
    });

    it("tells a failed listing apart from an empty one", async () => {
      foldersList.mockRejectedValue(new Error("worker down"));
      renderMenu("Movie");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: 'Subfolders of "Movie"' }),
        { button: 0, ctrlKey: false },
      );
      expect(
        await screen.findByRole("menuitem", {
          name: "Couldn't list the subfolders",
        }),
      ).toBeTruthy();
    });

    it("lists nothing for a folder that is gone", async () => {
      // Answered with the nearest ancestor: those children are not this folder's.
      foldersList.mockResolvedValue({
        path: "",
        folders: [
          {
            name: "Other",
            path: "Other",
            count: 1,
            subfolders: 0,
            previews: [],
          },
        ],
        fileCount: 0,
      });
      renderMenu("Gone");
      fireEvent.pointerDown(
        screen.getByRole("button", { name: 'Subfolders of "Gone"' }),
        { button: 0, ctrlKey: false },
      );
      expect(
        await screen.findByRole("menuitem", { name: "No subfolders" }),
      ).toBeTruthy();
      expect(screen.queryByRole("menuitem", { name: /Other/ })).toBeNull();
    });
  });
});
