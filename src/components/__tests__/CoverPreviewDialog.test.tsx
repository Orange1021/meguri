import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { CoverPreviewDialog } from "@/components/CoverPreviewDialog";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("CoverPreviewDialog", () => {
  it("shows the selected cover and reports an image load failure", () => {
    renderWithProviders(
      <CoverPreviewDialog
        open
        coverUrl="http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2"
        title="videos/sample.mp4"
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("videos/sample.mp4")).toBeTruthy();
    const image = screen.getByRole("img", { name: "videos/sample.mp4" });
    expect(image.getAttribute("src")).toContain("/thumb/1?v=2");

    fireEvent.error(image!);
    expect(screen.getByText("Could not load the cover preview")).toBeTruthy();
  });

  it("notifies the owner when Escape closes the preview", () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <CoverPreviewDialog
        open
        coverUrl="http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2"
        title="videos/sample.mp4"
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("clears a previous load failure when reopened", () => {
    const props = {
      coverUrl: "http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2",
      title: "videos/sample.mp4",
      onOpenChange: vi.fn(),
    };
    const view = renderWithProviders(<CoverPreviewDialog open {...props} />);
    fireEvent.error(screen.getByRole("img", { name: props.title }));
    expect(screen.getByText("Could not load the cover preview")).toBeTruthy();

    view.rerender(<CoverPreviewDialog open={false} {...props} />);
    view.rerender(<CoverPreviewDialog open {...props} />);

    expect(screen.getByRole("img", { name: props.title })).toBeTruthy();
  });
});
