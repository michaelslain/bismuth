// app/src/ui/gallery/activeItem.ts
// Pure selection logic for the SymbolGallery grid — extracted so the "what does
// Enter commit / what is highlighted by default" rule is unit-testable without a DOM.
//
// The rule (the bug this fixes): once the user is SEARCHING, the top search result
// is the default-selected candidate — NOT whatever `current` (the existing, app-library
// value) happens to be. With no query we fall back to highlighting `current` so opening
// the picker still points at the value already in use.

export type HasValue = { value: string };

/**
 * The index that should be active (highlighted + committed on Enter) the moment a
 * fresh set of results renders for `query`.
 * - Non-empty query → 0 (the top-ranked search result wins).
 * - Empty query → the cell matching `current`, else 0.
 * - No items → -1 (nothing to commit).
 */
export function defaultActiveIndex(query: string, items: readonly HasValue[], current?: string): number {
  if (items.length === 0) return -1;
  if (query.trim() !== "") return 0;
  if (current != null) {
    const i = items.findIndex((it) => it.value === current);
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * Move the active index within a grid of `count` cells laid out in `cols` columns.
 * Clamps at the edges (no wrap) and never leaves the valid range. `cols` is the live
 * rendered column count; callers pass >=1.
 */
export function moveActive(active: number, count: number, cols: number, dir: "left" | "right" | "up" | "down"): number {
  if (count <= 0) return -1;
  const c = Math.max(1, cols);
  const cur = active < 0 ? 0 : Math.min(active, count - 1);
  let next = cur;
  if (dir === "left") next = cur - 1;
  else if (dir === "right") next = cur + 1;
  else if (dir === "up") next = cur - c;
  else if (dir === "down") next = cur + c;
  if (next < 0 || next >= count) return cur;
  return next;
}
