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

    fireEvent.error(image);
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

      expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1.1)");
      fireEvent.wheel(image, { ctrlKey: true, deltaY: 100 });
      expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");
      expect(onWindowWheel).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("wheel", onWindowWheel);
    }
  });

  it("pans the cover while dragging after it has been zoomed", () => {
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

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 145,
      clientY: 150,
    });

    expect(image.style.transform).toBe("translate3d(45px, 30px, 0) scale(1.1)");
    expect(viewport.className).toContain("cursor-grabbing");

    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(viewport.className).toContain("cursor-grab");
  });

  it("releases the drag when pointer capture is lost", () => {
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

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.lostPointerCapture(viewport, { pointerId: 1 });

    expect(viewport.className).toContain("cursor-grab");

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 2,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      clientX: 120,
      clientY: 120,
    });

    expect(image.style.transform).toBe("translate3d(20px, 0px, 0) scale(1.1)");
  });

  it("keeps a zoomed cover inside the viewing canvas", () => {
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
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 1000 },
    });
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: 1000 },
      naturalHeight: { configurable: true, value: 1000 },
    });

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 300,
      clientY: 300,
    });

    expect(image.style.transform).toBe("translate3d(50px, 50px, 0) scale(1.1)");
  });

  it("supports arrow-key panning while the preview is zoomed", () => {
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
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 0 },
      clientHeight: { configurable: true, value: 0 },
    });

    fireEvent.keyDown(viewport, { key: "=" });
    fireEvent.keyDown(viewport, { key: "ArrowRight" });
    fireEvent.keyDown(viewport, { key: "ArrowDown", shiftKey: true });

    expect(viewport.getAttribute("tabindex")).toBe("0");
    expect(image.style.transform).toBe("translate3d(40px, 80px, 0) scale(1.1)");
  });

  it("does not pan at the natural zoom and resets the offset at one-to-one", () => {
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

    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 145,
      clientY: 150,
    });
    expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 2,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 2,
      clientX: 145,
      clientY: 150,
    });
    fireEvent.pointerUp(viewport, { pointerId: 2 });
    fireEvent.wheel(image, { ctrlKey: true, deltaY: 100 });

    expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");
  });

  it("stops an active drag when zooming back to the natural size", () => {
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

    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerDown(viewport, {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 120,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 145,
      clientY: 150,
    });
    fireEvent.wheel(image, { ctrlKey: true, deltaY: 100 });
    fireEvent.wheel(image, { ctrlKey: true, deltaY: -100 });
    fireEvent.pointerMove(viewport, {
      pointerId: 1,
      clientX: 250,
      clientY: 250,
    });

    expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1.1)");
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
    expect(image.style.transform).toBe("translate3d(0px, 0px, 0) scale(1.1)");

    view.rerender(<CoverPreviewDialog open={false} {...props} />);
    view.rerender(<CoverPreviewDialog open {...props} />);

    expect(screen.getByRole("img", { name: props.title }).style.transform).toBe(
      "translate3d(0px, 0px, 0) scale(1)",
    );
  });
});
