// Natural file-name order: "clip-9" before "clip-10".
//
// SQLite's own collations compare text byte by byte, which puts "10" before "9",
// and a per-row expression (padding digits at query time) would cost the index
// scan that sorting and keyset paging are built on. So the order is computed
// once, when the row is written, and stored as files.sort_key.
//
// Folders are ordered in JS with an `Intl.Collator` (numeric, case-insensitive);
// this key is the SQL-side equivalent: lower-cased, with every run of digits
// padded to a fixed width so that comparing the padded text byte for byte gives
// the same answer as comparing the numbers.
//
// The same function runs on both sides — the row is written with it, and the
// All view's k-way merge re-implements the ordering in JS — so the two orders
// cannot drift apart.

/** Wider than any number a file name carries in practice. */
const DIGIT_WIDTH = 18;

const DIGIT_RUN = /\d+/g;

export function nameSortKey(relPath: string): string {
  return relPath
    .toLowerCase()
    .replace(DIGIT_RUN, (digits) => digits.padStart(DIGIT_WIDTH, "0"));
}
