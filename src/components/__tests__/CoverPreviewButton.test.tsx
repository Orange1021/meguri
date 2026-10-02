import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { CoverPreviewButton } from "@/components/CoverPreviewButton";
import { renderWithProviders } from "@/test/renderWithProviders";

describe("CoverPreviewButton", () => {
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
});
