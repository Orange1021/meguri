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

  it("uses a bounded viewing canvas instead of rendering the thumbnail at native size", () => {
    renderWithProviders(
      <CoverPreviewDialog
        open
        coverUrl="http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2"
        title="videos/sample.mp4"
        onOpenChange={vi.fn()}
      />,
    );

    const viewport = screen.getByTestId("cover-preview-viewport");
    const image = screen.getByRole("img", { name: "videos/sample.mp4" });

    expect(viewport.className).toContain("h-[min(78vh,42rem)]");
    expect(image.className).toContain("h-full");
    expect(image.className).toContain("w-full");
  });

  it("zooms the cover without bubbling pinch zoom to the main window", () => {
    const onWindowWheel = vi.fn();
    window.addEventListener("wheel", onWindowWheel);

    try {
      renderWithProviders(
        <CoverPreviewDialog
          open
          coverUrl="http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2"
          title="videos/sample.mp4"
          onOpenChange={vi.fn()}
        />,
      );

      const image = screen.getByRole("img", { name: "videos/sample.mp4" });
      fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });

      expect(image.style.transform).toBe("scale(1.1)");
      fireEvent.wheel(image, { ctrlKey: true, deltaY: 100 });
      expect(image.style.transform).toBe("scale(1)");
      expect(onWindowWheel).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("wheel", onWindowWheel);
    }
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

  it("resets the cover zoom when the preview reopens", () => {
    const props = {
      coverUrl: "http://127.0.0.1:17345/ws/ws-test-abc123/thumb/1?v=2",
      title: "videos/sample.mp4",
      onOpenChange: vi.fn(),
    };
    const view = renderWithProviders(<CoverPreviewDialog open {...props} />);
    const image = screen.getByRole("img", { name: props.title });

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    expect(image.style.transform).toBe("scale(1.1)");

    view.rerender(<CoverPreviewDialog open={false} {...props} />);
    view.rerender(<CoverPreviewDialog open {...props} />);

    expect(screen.getByRole("img", { name: props.title }).style.transform).toBe(
      "scale(1)",
    );
  });
});
