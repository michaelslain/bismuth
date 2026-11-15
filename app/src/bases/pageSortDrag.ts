// app/src/bases/pageSortDrag.ts
// The pure geometry of dragging an item to a new place in a list: pages in the book's page sorter
// (BookPageEditor) and cards in the flashcard deck editor (CardsListEditor). The drag itself is
// pointer events, not HTML5 drag-and-drop, which the app's WKWebView never delivers.

/** Pixels the pointer travels before a press on a page becomes a drag. */
export const DRAG_THRESHOLD = 4

/** Pixels from the grid's top or bottom edge inside which a drag scrolls the grid. */
export const EDGE_SCROLL_ZONE = 48

/** Has the pointer moved far enough from where it went down to start a drag? */
export function pastThreshold(dx: number, dy: number, threshold = DRAG_THRESHOLD): boolean {
    return dx * dx + dy * dy > threshold * threshold
}

/** The drop slot for a pointer over tile `i`, along one axis: before it (`i`) on its first half,
 *  after it (`i + 1`) on its second. Pass left/width/x for a row of tiles, top/height/y for a column. */
export function slotForTile(left: number, width: number, x: number, i: number): number {
    return x - left < width / 2 ? i : i + 1
}

/** The index a tile lifted from `from` lands at when dropped in slot `at` (slots run 0..n, before
 *  each tile and after the last). Lifting the tile out shifts every later slot back by one. */
export function moveTarget(from: number, at: number): number {
    return at > from ? at - 1 : at
}

/** Pixels to scroll the grid this frame: negative near the top edge, positive near the bottom,
 *  faster the deeper into the zone, 0 elsewhere. */
export function edgeScrollStep(top: number, bottom: number, y: number, zone = EDGE_SCROLL_ZONE, max = 18): number {
    if (y < top + zone) return -Math.ceil(max * Math.min(1, (top + zone - y) / zone))
    if (y > bottom - zone) return Math.ceil(max * Math.min(1, (y - (bottom - zone)) / zone))
    return 0
}

/** What the drag ghost says for a tile: `page 3` for a bare page number, the caption otherwise. */
export function ghostLabel(caption: string): string {
    return /^\d+$/.test(caption) ? `page ${caption}` : caption
}
