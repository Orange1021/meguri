// Aggregation behind the bulk tag dialog. Kept apart from the component so the
// counting rules — which decide what "some of them have this" means on screen —
// can be tested without rendering anything.
import type { FileRow } from "@/ipc/types";

/** One tag name across a selection, with how many of the rows carry it. */
export interface TagTally {
  name: string;
  /** Rows carrying the tag. Equal to the selection size when every row has it. */
  count: number;
}

/**
 * User-created tag names across the selection, most widely shared first and
 * then alphabetical, so the tags an edit would touch everywhere sort to the
 * front.
 *
 * Only manual tags are counted, matching exactly what the edit can act on:
 * bulkEditManualTags detaches `source = 'manual'` rows and nothing else, so a
 * tag shown here that came from a pipeline would offer a removal that silently
 * does nothing — and raising it to the whole selection would copy it onto the
 * other files as a manual tag, which is not what the chip said. The single-file
 * TagEditor draws the same line.
 */
export function tallySelectionTags(rows: FileRow[]): TagTally[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    // Per row, not per tag row: the same name can arrive from two sources.
    const names = new Set(
      (row.tags ?? [])
        .filter((tag) => tag.namespace === "" && tag.source === "manual")
        .map((tag) => tag.name),
    );
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
