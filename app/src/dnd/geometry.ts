// app/src/dnd/geometry.ts
// Pure geometry for the view-drag system: where does a point land inside a pane
// (which split direction / center-replace), and where would a dragged tab chip
// insert among the strip. No DOM — fully unit-testable.

export type Zone = 'left' | 'right' | 'up' | 'down' | 'center'
export type Rect = { x: number; y: number; w: number; h: number }

// Half-width (as a fraction of the pane, measured from center) of the square
// "replace" band. 0.18 → the middle ~36% on each axis replaces; everything
// outside splits along its nearest edge.
const CENTER_HALF = 0.18

// Nearest edge of a rect to a point — horizontal wins diagonal ties. No center
// band: used directly by file-tree drops (which always split) and as the edge
// half of dropZoneForPoint.
export function nearestEdge(
    rect: Rect,
    x: number,
    y: number,
): Exclude<Zone, 'center'> {
    const fx = (x - rect.x) / rect.w - 0.5
    const fy = (y - rect.y) / rect.h - 0.5
    if (Math.abs(fx) >= Math.abs(fy)) return fx < 0 ? 'left' : 'right'
    return fy < 0 ? 'up' : 'down'
}

// Which drop zone a point falls in within a pane rect. The middle band replaces;
// outside it, the nearest edge wins.
export function dropZoneForPoint(rect: Rect, x: number, y: number): Zone {
    const fx = (x - rect.x) / rect.w - 0.5
    const fy = (y - rect.y) / rect.h - 0.5
    if (Math.abs(fx) <= CENTER_HALF && Math.abs(fy) <= CENTER_HALF)
        return 'center'
    return nearestEdge(rect, x, y)
}

// Half-width (as a fraction of the pane, measured from center) of the band that counts as
// "center" for a reference drop (drop-to-[[wikilink]] anywhere on a note editor, Row 74c): the
// outer 10% of each axis is the edge band, everything else — including nearly the whole pane —
// is center. Deliberately much larger than CENTER_HALF's split-replace band.
const REFERENCE_EDGE = 0.4 // outer band starts at 0.5 - 0.4 = 0.1 from the axis extreme

// Which zone a point falls in for an editor reference drop: `center` unless the point is within
// the outer 10% of the pane's width (left/right) or height (up/down), where it's `nearestEdge`.
// Used instead of dropZoneForPoint when the target pane is a note and the drag payload is
// referenceable — so a drop lands as a wikilink insert almost everywhere on the pane, not just
// dropZoneForPoint's small middle box.
export function referenceZoneForPoint(rect: Rect, x: number, y: number): Zone {
    const fx = (x - rect.x) / rect.w - 0.5
    const fy = (y - rect.y) / rect.h - 0.5
    if (Math.abs(fx) <= REFERENCE_EDGE && Math.abs(fy) <= REFERENCE_EDGE)
        return 'center'
    return nearestEdge(rect, x, y)
}

// Insertion index (0..n) where a dragged chip would land among `chips` (in DOM
// order) for a cursor at `x`: the number of chips whose horizontal midpoint sits
// left of the cursor.
export function insertionIndexForX(
    chips: { x: number; w: number }[],
    x: number,
): number {
    let i = 0
    for (const c of chips) {
        if (c.x + c.w / 2 < x) i++
    }
    return i
}

// Vertical equivalent: insertion index for a VERTICAL tab strip (right-edge rail
// in ui.verticalTabs mode). The chips' `y` and `h` replace `x` and `w`.
export function insertionIndexForY(
    chips: { y: number; h: number }[],
    y: number,
): number {
    let i = 0
    for (const c of chips) {
        if (c.y + c.h / 2 < y) i++
    }
    return i
}
