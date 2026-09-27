import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { FolderBreadcrumb } from "@/components/FolderBreadcrumb";
import { renderWithProviders } from "@/test/renderWithProviders";

function render(path: string) {
  const onNavigate = vi.fn();
  const onBack = vi.fn();
  const onUp = vi.fn();
  renderWithProviders(
    <FolderBreadcrumb
      rootLabel="Videos"
      path={path}
      onNavigate={onNavigate}
      canGoBack={path !== ""}
      onBack={onBack}
      onUp={onUp}
    />,
  );
  return { onNavigate, onBack, onUp, nav: screen.getByRole("navigation") };
}

describe("FolderBreadcrumb", () => {
  it("shows only the root, as the current level, at the root", () => {
    const { nav } = render("");
    expect(
      within(nav)
        .queryAllByRole("button")
        .filter((b) => !(b as HTMLButtonElement).disabled),
    ).toHaveLength(0);
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
});
