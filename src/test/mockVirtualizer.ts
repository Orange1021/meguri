import { vi } from "vitest";

const spies = vi.hoisted(() => ({ scrollToIndex: vi.fn() }));

/**
 * What the views asked the virtualizer to scroll to. Shared across renders so a
 * test can assert on it: a fresh mock per render would be unreachable.
 */
export const virtualizerScrollToIndex = spies.scrollToIndex;

/** Render all virtual rows in jsdom (no layout engine / scroll viewport). */
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (opts: { count: number; estimateSize: () => number }) => {
    const rowHeight = opts.estimateSize();
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, index) => ({
          key: String(index),
          index,
          start: index * rowHeight,
        })),
      getTotalSize: () => opts.count * rowHeight,
      measureElement: () => {},
      measure: () => {},
      scrollToOffset: vi.fn(),
      // Keyboard focus navigation scrolls the focused row into view, and so
      // does the list pointing at the file the detail sheet is showing.
      scrollToIndex: spies.scrollToIndex,
    };
  },
}));
