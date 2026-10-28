// The list points at the file the detail sheet is showing: a file opened from
// Discovery can land anywhere in the order, and the row sitting under the
// sheet is what tells the user where they are.
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { virtualizerScrollToIndex } from "@/test/mockVirtualizer";
import { MediaList } from "@/components/MediaList";
import { sampleFileRow, WS_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/renderWithProviders";

vi.mock("@/ipc/client", () => ({
  api: { workspacesList: () => Promise.resolve({ workspaces: [], collections: [] }) },
  ALL_ID: "__all__",
}));

const files = () =>
  [1, 2, 3].map((id) => ({
    ...sampleFileRow,
    id,
    relPath: `clip-${id}.mp4`,
  }));

function renderList(activeFileId: number | null) {
  return renderWithProviders(
    <MediaList
      items={files()}
      mediaBase="http://127.0.0.1:17345"
      workspaceId={WS_ID}
      loading={false}
      thumbVersion={{}}
      activeFileId={activeFileId}
    />,
  );
}

describe("MediaList active row", () => {
  it("marks that row and scrolls it into view", async () => {
    virtualizerScrollToIndex.mockClear();
    renderList(1);
    await screen.findByText("clip-1.mp4");

    const active = screen.getByText("clip-1.mp4").closest("[data-active]");
    expect(active).not.toBeNull();
    expect(active?.getAttribute("aria-current")).toBe("page");
    expect(
      screen.getByText("clip-2.mp4").closest("[data-active]"),
    ).toBeNull();
    // Rows are one entry each, so the first file is row 0.
    expect(virtualizerScrollToIndex).toHaveBeenCalledWith(0, { align: "auto" });
  });

  it("leaves the list where it is when the file is not among the loaded entries", async () => {
    virtualizerScrollToIndex.mockClear();
    renderList(999);
    await screen.findByText("clip-1.mp4");
    expect(document.querySelector('[data-active="true"]')).toBeNull();
    expect(virtualizerScrollToIndex).not.toHaveBeenCalled();
  });

  it("stays out of the way while the detail is a modal", async () => {
    virtualizerScrollToIndex.mockClear();
    renderList(null);
    await screen.findByText("clip-1.mp4");
    expect(document.querySelector('[data-active="true"]')).toBeNull();
    expect(virtualizerScrollToIndex).not.toHaveBeenCalled();
  });
});
