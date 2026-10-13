// app/src/preview/scratchResize.ts
// Width arithmetic for dragging the line between a page and its scratch strip — pure, no
// framework imports. The strip's width is the sidecar's margin RATIO (core/src/drawing/pageMargin.ts),
// so a drag in px becomes a ratio here.
//
// How the line moves with the ratio is the surface's own layout: a PDF page and its strip share
// one fixed width, so the page shrinks as the strip grows; an image shown at its natural size
// keeps its width and the picture + strip unit re-centres instead. So the caller hands in that
// layout as `lineAt` (ratio → the line's x), and the drag solves for the ratio that puts the line
// under the pointer — the line follows the pointer on every surface.
import { DEFAULT_MARGIN_RATIO, MAX_MARGIN_RATIO } from '../../../core/src/drawing/pageMargin'
import { SNAP_DISTANCE } from '../edgeResize'

/** The narrowest strip a drag leaves: a tenth of the page. Narrower is not paper to write on;
 *  turning scratch off is the line's click (or the bar's toggle), not a drag to nothing. */
export const MIN_MARGIN_RATIO = 0.1

/** Where the line between a page and its strip sits, in px, for a given margin ratio. A wider
 *  strip never moves the line rightward. */
export type ScratchLineAt = (ratio: number) => number

/** `lineAt` for a page and strip that share one fixed width (a PDF page at any zoom): the line
 *  sits `total / (1 + ratio)` from the unit's left edge. `pageW` + `marginW` are the rendered
 *  widths at any one ratio. */
export function fixedUnitLine(pageW: number, marginW: number): ScratchLineAt {
    const total = pageW + marginW
    return ratio => total / (1 + ratio)
}

/** The margin ratio after dragging the page|strip line `dx` px (+ = rightward, narrowing the
 *  strip) from `startLine`, where it sat at press time. The ratio whose line lands under the
 *  pointer, clamped to [MIN_MARGIN_RATIO, MAX_MARGIN_RATIO] and rounded to 3 decimals so the
 *  sidecar stores a short number — or DEFAULT_MARGIN_RATIO when the pointer is within
 *  SNAP_DISTANCE px of the default's line, the same detent the sidebar's edge has. */
export function dragMarginRatio(lineAt: ScratchLineAt, startLine: number, dx: number): number {
    const target = startLine + dx
    if (Math.abs(lineAt(DEFAULT_MARGIN_RATIO) - target) <= SNAP_DISTANCE)
        return DEFAULT_MARGIN_RATIO
    let lo = MIN_MARGIN_RATIO
    let hi = MAX_MARGIN_RATIO
    if (target >= lineAt(lo)) return lo
    if (target <= lineAt(hi)) return hi
    // lineAt(lo) > target > lineAt(hi): bisect to well under a pixel.
    for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2
        if (lineAt(mid) > target) lo = mid
        else hi = mid
    }
    return Math.round(((lo + hi) / 2) * 1000) / 1000
}
