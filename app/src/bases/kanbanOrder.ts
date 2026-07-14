// Pure helper for the kanban add-card flow (#93). A column's cards sort by an explicit
// numeric `order` frontmatter property when present (drag-reorder writes 0..n onto every
// card it touches), falling back to the row's stable engine position. A NEW card used to be
// written with no `order` at all: it rendered optimistically at the bottom, then — once the
// file-watcher refetch replaced the optimistic row with the real one — its indexOf fallback
// interleaved with the siblings' explicit orders and the card teleported into the middle of
// the column. Appending with an order strictly greater than every current sort key pins the
// new card to the bottom, before AND after the server row lands.

/** The `order` value for a card appended to a column, given the column's current
 *  (pre-insertion) within-column sort keys (each row's effective order). Strictly
 *  greater than every existing key so the new card sorts last; never below 0 (0 for
 *  an empty or all-negative column — negatives only arise from hand-edited
 *  frontmatter).
 *
 *  Cards without an explicit `order` fall back to `group.rows.indexOf(row)` (see
 *  `effOrder` in KanbanView.tsx). That fallback is recomputed AFTER the SSE refetch
 *  rebuilds the column with the new card inserted — growing it from n to n+1 rows — so
 *  an implicit sibling's indexOf can climb as high as n (0-based last index of the
 *  GROWN column, i.e. `sortKeys.length` since sortKeys is measured pre-insertion). If
 *  the new card's fixed order only exceeded the pre-insertion max, a sibling's
 *  post-insertion indexOf could tie or exceed it, scattering the new card into the
 *  middle once the stable sort resolves the tie alphabetically. Comparing against
 *  `sortKeys.length` as well as the max guarantees the new card outranks every
 *  possible post-insertion implicit key, not just the pre-insertion ones. */
export function appendOrder(sortKeys: number[]): number {
  let max = -1;
  for (const k of sortKeys) {
    if (Number.isFinite(k) && k > max) max = k;
  }
  return Math.max(max, sortKeys.length) + 1;
}
