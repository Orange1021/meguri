// The selection's re-render fan-out, which is a stated requirement of the
// feature (#119: "the selection state does not re-render unselected rows") and
// not just a nicety: a row carries a thumbnail, tag chips and three of its own
// controls, so re-rendering every mounted row per click made a Shift range over
// a full viewport re-render all of it.
import { describe, expect, it, vi } from "vitest";
import { memo } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  SelectionProvider,
  useIsSelected,
  useSelection,
  useSelectionMode,
} from "@/components/SelectionContext";
import { sampleFileRow } from "@/test/fixtures";
import type { FileRow } from "@/ipc/types";

vi.mock("@/ipc/client", () => ({ api: {}, ALL_ID: "__all__" }));

const items: FileRow[] = [1, 2, 3, 4].map((id) => ({ ...sampleFileRow, id }));

/** Stands in for a row: memoized, stable props, reads the selection per value. */
function makeRow(counts: Map<number, number>) {
  return memo(function Row({ file, index }: { file: FileRow; index: number }) {
    const { click } = useSelectionMode();
    useIsSelected(file);
    counts.set(file.id, (counts.get(file.id) ?? 0) + 1);
    return (
      <button type="button" onClick={(e) => click(file, index, e)}>
        row{file.id}
      </button>
    );
  });
}

/** Leaving selection mode is only reachable from the bar, not from a row. */
function Exit() {
  const selection = useSelection();
  return (
    <button type="button" onClick={selection.exit}>
      exit
    </button>
  );
}

function renderRows() {
  const counts = new Map<number, number>();
  const Row = makeRow(counts);
  render(
    <SelectionProvider items={items} scope="one">
      {items.map((file, index) => (
        <Row key={file.id} file={file} index={index} />
      ))}
      <Exit />
    </SelectionProvider>,
  );
  const since = () => {
    const base = new Map(counts);
    return () =>
      new Map([...counts].map(([id, n]) => [id, n - (base.get(id) ?? 0)]));
  };
  return { counts, since };
}

describe("selection re-renders", () => {
  it("re-renders only the row whose membership changed", () => {
    const { since } = renderRows();
    // The first click also turns selection mode on, which every row has to see:
    // that is when the checkboxes appear.
    fireEvent.click(screen.getByText("row1"));
    const delta = since();
    fireEvent.click(screen.getByText("row2"));
    expect([...delta()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 0],
      [4, 0],
    ]);
  });

  it("re-renders every row once when selection mode turns on", () => {
    const { since } = renderRows();
    const delta = since();
    fireEvent.click(screen.getByText("row1"));
    expect([...delta()].map(([, n]) => n)).toEqual([1, 1, 1, 1]);
  });

  it("re-renders a range's rows once each, and no others", () => {
    const { since } = renderRows();
    fireEvent.click(screen.getByText("row1"));
    const delta = since();
    fireEvent.click(screen.getByText("row3"), { shiftKey: true });
    // Rows 1..3 are in the range; row 1 was already picked, so nothing about it
    // moved and it is skipped too.
    expect([...delta()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 1],
      [4, 0],
    ]);
  });

  it("re-renders only the rows it deselects", () => {
    const { since } = renderRows();
    fireEvent.click(screen.getByText("row1"));
    fireEvent.click(screen.getByText("row2"));
    const delta = since();
    fireEvent.click(screen.getByText("row1"));
    fireEvent.click(screen.getByText("row2"));
    // Emptying the selection does not leave selection mode — the bar stays, as
    // the only way out — so the rows that were never picked see nothing.
    expect([...delta()]).toEqual([
      [1, 1],
      [2, 1],
      [3, 0],
      [4, 0],
    ]);
  });

  it("re-renders every row once when selection mode ends", () => {
    const { since } = renderRows();
    fireEvent.click(screen.getByText("row1"));
    const delta = since();
    fireEvent.click(screen.getByText("exit"));
    // The mirror of entering it: every checkbox has to go away.
    expect([...delta()].map(([, n]) => n)).toEqual([1, 1, 1, 1]);
  });
});
