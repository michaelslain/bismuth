// app/src/drawing/lasso.ts
//
// The PURE half of "select it and move it around" — the user's second complaint, after "i cant
// place text after it". Given a block's strokes and a freehand polygon, say which strokes are
// selected; then move or resize them. No DOM, no CodeMirror, no canvas: everything here is
// arithmetic on `Stroke.pts`, so it runs headless under `bun test` and the overlay is left with
// nothing but pointer plumbing.
//
// ── The rules these functions encode ────────────────────────────────────────────────────────
//
//  1. A stroke is selected only when EVERY one of its points is inside the polygon. Partial
//     selection would have to cut the stroke, and cutting is reserved for block seams
//     (Decision 4 of the design) where it buys something; here it would just shred a squiggle
//     the user lassoed carelessly.
//  2. A selection belongs to exactly ONE block, because a stroke does (the design's central
//     rule). `pickOwningBlock` is where that is enforced, rather than in the overlay, so it is
//     testable.
//  3. Resizing scales the STROKE WIDTH with the geometry. A sketch shrunk to half size with a
//     full-width pen does not read as the same drawing; it reads as a different, fatter one.
//  4. A move or resize is CLAMPED so ink cannot leave the space it belongs to — the reading
//     column horizontally, and (for an attached fence) the block it annotates vertically. The
//     clamp is a UNION of the limit and where the ink already is, so ink that already overhangs
//     keeps its overhang instead of being yanked back in by the first drag.
//
// ── The coordinate space these functions work in ────────────────────────────────────────────
// They are space-agnostic on purpose: every function takes coordinates in whatever space the
// caller hands it. The caller (InkOverlay) does the conversion, because the conversion is the
// part that differs per fence mode — an attached fence stores y in unscaled PIXELS against its
// block's top while x stays in the 680px logical column, so a painted-space delta of `dy` is a
// stored-space delta of `dy / yScale`, and a painted-space scale ORIGIN maps to
// `(oy - blockTop) / yScale`. The FACTOR is the same in both spaces (scaling is linear), which
// is why only the origin needs converting. See inkCommit.ts for the contract itself.
import type { Stroke } from '../../../core/src/drawing/model'
import { inkBounds, type InkBounds } from '../editor/drawBlockGeometry'

/** Smallest resize factor a drag may produce. Below this a drawing is a dot and there is no
 *  handle left to grab to undo it. */
export const MIN_SCALE = 0.05

/** Ray casting: is `(x, y)` inside the closed polygon `[x0, y0, x1, y1, …]`? A point exactly on
 *  an edge is deliberately not special-cased — a hand-drawn lasso never lands on one, and the
 *  even-odd rule already gives a consistent answer for the ones that do. */
export function pointInPolygon(
    polygon: number[],
    x: number,
    y: number,
): boolean {
    const n = Math.floor(polygon.length / 2)
    if (n < 3) return false
    let inside = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = polygon[i * 2]
        const yi = polygon[i * 2 + 1]
        const xj = polygon[j * 2]
        const yj = polygon[j * 2 + 1]
        if (yi > y === yj > y) continue
        if (x < xi + ((y - yi) / (yj - yi)) * (xj - xi)) inside = !inside
    }
    return inside
}

/** Indices of the strokes lying WHOLLY inside `polygon`. A stroke with no points is never
 *  selected — `every` over an empty list is vacuously true, which would otherwise hand the
 *  caller a selection of nothing that behaves like a selection of something. */
export function strokesInLasso(strokes: Stroke[], polygon: number[]): number[] {
    const out: number[] = []
    for (let i = 0; i < strokes.length; i++) {
        const pts = strokes[i].pts
        if (pts.length < 3) continue
        let all = true
        for (let j = 0; j + 1 < pts.length; j += 3) {
            if (!pointInPolygon(polygon, pts[j], pts[j + 1])) {
                all = false
                break
            }
        }
        if (all) out.push(i)
    }
    return out
}

/** A block's ink as the lasso sees it: its own line, and its strokes ALREADY MAPPED INTO THE
 *  PAINTED SPACE the polygon was drawn in. The caller does that mapping because it differs per
 *  fence mode. */
export interface LassoBlock {
    fromLine: number
    strokes: Stroke[]
}

/** The one block a lasso selects from, and which of its strokes.
 *
 *  A lasso thrown across a block seam catches strokes from both sides, and honouring that would
 *  mean one gesture editing two fences — with two different coordinate contracts, and a "move"
 *  that changes which block owns a stroke. A stroke belongs to exactly one block, so a selection
 *  does too: the block contributing the MOST strokes wins, ties going to the higher one on the
 *  page (the smaller `fromLine`), and the rest of the lassoed ink is simply not selected.
 *
 *  `null` when the lasso caught nothing at all. */
export function pickOwningBlock(
    blocks: LassoBlock[],
    polygon: number[],
): { fromLine: number; indices: number[] } | null {
    let best: { fromLine: number; indices: number[] } | null = null
    for (const b of blocks) {
        const indices = strokesInLasso(b.strokes, polygon)
        if (!indices.length) continue
        if (!best || indices.length > best.indices.length) {
            best = { fromLine: b.fromLine, indices }
        }
    }
    return best
}

/** Move every point by `(dx, dy)`. The pressure byte is geometry-free and is left alone. */
export function translateStrokes(
    strokes: Stroke[],
    dx: number,
    dy: number,
): Stroke[] {
    return strokes.map(s => ({
        ...s,
        pts: s.pts.map((n, i) =>
            i % 3 === 0 ? n + dx : i % 3 === 1 ? n + dy : n,
        ),
    }))
}

/** Scale geometry AND stroke width about `(originX, originY)`. Uniform: one factor for both
 *  axes, because a pen nib is round and a non-uniform scale would turn it into an ellipse the
 *  renderer has no way to express (the same reason InkOverlay transforms points rather than the
 *  canvas). */
export function scaleStrokes(
    strokes: Stroke[],
    originX: number,
    originY: number,
    factor: number,
): Stroke[] {
    return strokes.map(s => ({
        ...s,
        w: s.w * factor,
        pts: s.pts.map((n, i) =>
            i % 3 === 0
                ? originX + (n - originX) * factor
                : i % 3 === 1
                  ? originY + (n - originY) * factor
                  : n,
        ),
    }))
}

/** The range a moved or resized box is allowed to occupy: the limit, WIDENED to already contain
 *  the box. Ink that overhangs its block (a circle drawn a little taller than the paragraph it
 *  rings, which is the normal way people annotate) must not be dragged straight back inside by
 *  the first pixel of movement — but it must not be allowed to overhang any further either. */
function allowed(bounds: InkBounds, limit: InkBounds): InkBounds {
    return {
        minX: Math.min(limit.minX, bounds.minX),
        minY: Math.min(limit.minY, bounds.minY),
        maxX: Math.max(limit.maxX, bounds.maxX),
        maxY: Math.max(limit.maxY, bounds.maxY),
    }
}

/** Trim a drag so the selection's bounding box stays inside `limit`. Always returns a delta the
 *  caller can use directly; the allowed interval always contains 0, so a clamped drag stalls
 *  rather than jumping. */
export function clampDelta(
    bounds: InkBounds,
    dx: number,
    dy: number,
    limit: InkBounds,
): { dx: number; dy: number } {
    const a = allowed(bounds, limit)
    return {
        dx: Math.min(
            Math.max(dx, a.minX - bounds.minX),
            a.maxX - bounds.maxX,
        ),
        dy: Math.min(
            Math.max(dy, a.minY - bounds.minY),
            a.maxY - bounds.maxY,
        ),
    }
}

/** How far one edge may travel before it leaves `[lo, hi]`, as a bound on the scale factor.
 *  `Infinity` for an edge sitting on the origin, which does not move at all. */
function edgeCap(edge: number, origin: number, lo: number, hi: number): number {
    const a = edge - origin
    if (Math.abs(a) < 1e-9) return Infinity
    return a > 0 ? (hi - origin) / a : (lo - origin) / a
}

/** Trim a resize so the scaled box stays inside `limit`.
 *
 *  Only an UPPER cap is needed: the origin is a corner of the current box, so for any factor in
 *  (0, 1] the scaled box is contained in the original one and is therefore already inside. */
export function clampScale(
    bounds: InkBounds,
    originX: number,
    originY: number,
    factor: number,
    limit: InkBounds,
): number {
    const a = allowed(bounds, limit)
    const cap = Math.min(
        edgeCap(bounds.minX, originX, a.minX, a.maxX),
        edgeCap(bounds.maxX, originX, a.minX, a.maxX),
        edgeCap(bounds.minY, originY, a.minY, a.maxY),
        edgeCap(bounds.maxY, originY, a.minY, a.maxY),
    )
    return Math.max(MIN_SCALE, Math.min(factor, cap))
}

/** The bounding box of a subset of a block's strokes, or null when the subset is empty. A thin
 *  convenience over `inkBounds` so callers never have to build the intermediate array by hand. */
export function selectionBounds(
    strokes: Stroke[],
    indices: number[],
): InkBounds | null {
    return inkBounds(indices.map(i => strokes[i]).filter(Boolean))
}
