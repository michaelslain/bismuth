// Pure helpers for the kanban COLUMN drag-reorder + its drop-gap placeholder. A column drag
// resolves, on every pointer move, the hovered column key + which half of it the cursor is in
// (`after`); from those we compute the insertion index the dragged column will land at. The SAME
// index drives both the between-columns placeholder shown during the drag AND the persisted order
// on drop — so what the user sees is exactly where the column goes.

/** The insertion index the dragged column (`from`) lands at, expressed among the OTHER columns
 *  (i.e. `keys` with `from` removed). `over` is the hovered column's key; `after` drops it into the
 *  slot to the RIGHT of `over`. Returns a value in `[0, others.length]`.
 *
 *  Edge cases:
 *  - `over === null` (cursor off any column) or `over === from` (hovering the dragged column
 *    itself): keep the column at its current position — clamp `from`'s own index into the others
 *    list — so a drop there is a no-op rather than a jump.
 *  - `over` not found in `keys` (stale key): append to the end. */
export function columnDropIndex(
  keys: string[],
  from: string,
  over: string | null,
  after: boolean,
): number {
  const others = keys.filter((k) => k !== from);
  if (over === null || over === from) {
    return Math.min(others.length, Math.max(0, keys.indexOf(from)));
  }
  let ti = others.indexOf(over);
  if (ti < 0) return others.length;
  if (after) ti += 1;
  return ti;
}

/** The full column-key order after dropping `from` at the resolved gap. Removing `from` then
 *  re-inserting it at `columnDropIndex` keeps every other column's relative order intact; a no-op
 *  drop (see the edge cases above) reinserts `from` at its original slot, yielding `keys` unchanged
 *  in relative order. */
export function reorderColumnKeys(
  keys: string[],
  from: string,
  over: string | null,
  after: boolean,
): string[] {
  const others = keys.filter((k) => k !== from);
  const ti = columnDropIndex(keys, from, over, after);
  return [...others.slice(0, ti), from, ...others.slice(ti)];
}
