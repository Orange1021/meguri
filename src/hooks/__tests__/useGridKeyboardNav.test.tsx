// Keyboard movement over a grid whose first row opens with empty cells (a
// window that starts mid-row): moves stay in their column.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useGridKeyboardNav } from "@/hooks/useGridKeyboardNav";
import { PreferencesProvider } from "@/settings/PreferencesProvider";

function setup(leadingCells: number) {
  const scrollToRow = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PreferencesProvider>{children}</PreferencesProvider>
  );
  // Cells, 3 per row, 2 empty before item 0:
  //   [ _ _ 0 ] [ 1 2 3 ] [ 4 ]
  const hook = renderHook(
    () =>
      useGridKeyboardNav({
        itemCount: 5,
        columns: 3,
        active: true,
        onOpen: () => {},
        scrollToRow,
        leadingCells,
      }),
    { wrapper },
  );
  const press = (code: string) =>
    act(() => {
      fireEvent.keyDown(window, { key: code, code });
    });
  return { hook, press, scrollToRow };
}

describe("useGridKeyboardNav with leading cells", () => {
  it("steps down within the column the cells put an item in", () => {
    const { hook, press, scrollToRow } = setup(2);
    press("ArrowDown");
    expect(hook.result.current.focusedIndex).toBe(0);
    press("ArrowDown");
    // Item 0 sits in the third column; below it is item 3.
    expect(hook.result.current.focusedIndex).toBe(3);
    expect(scrollToRow).toHaveBeenLastCalledWith(1);
    press("ArrowDown");
    // The last row is short: clamp to its last item.
    expect(hook.result.current.focusedIndex).toBe(4);
    expect(scrollToRow).toHaveBeenLastCalledWith(2);
  });
});
