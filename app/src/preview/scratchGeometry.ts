// app/src/preview/scratchGeometry.ts
// Pure geometry for scratch-note blocks (ScratchTextLayer.tsx): where a page's scratch STRIP sits in
// the logical page space, where a block renders in host px, what a click on a strip creates, and
// which strip a host point is over.
//
// Same coordinate contract as ink (core/src/drawing/pageInk.ts): a block's x/y/w live in the
// sidecar's 816x1056 logical page space, the source page occupies `box` inside it, and one scale
// `k = rendered.w / box.w` maps logical units to host px for BOTH axes — computed from the page's own
// rendered width, never the margin-widened one, so a strip block sits at the page's density (the
// PageInk "Margin:" rule). The strip is the band to the right of the box: logical x from
// `box.x + box.w` for `marginW / k` units.
//
// Block positions are whole logical units (the companion note writes them that way), so `placeAt`
// and `dropAt` round — at most half a unit, well under a pixel at any readable zoom.
//
// No DOM, no framework.
import {
    screenToLogical,
    type LogicalBox,
} from '../../../core/src/drawing/pageInk'
import type { PageInkPage } from './PageInk'
import {
    SCRATCH_MIN_W,
    SCRATCH_PAD,
    SCRATCH_REF_SCALE,
    type ScratchBlock,
} from '../../../core/src/scratchTypes'

/** Logical x range of page i's strip: [box.x + box.w, box.x + box.w + marginW * box.w / rendered.w]. */
export function stripRangeLogical(
    page: PageInkPage,
    box: LogicalBox,
): { x0: number; x1: number } {
    const x0 = box.x + box.w
    return { x0, x1: x0 + ((page.marginW ?? 0) * box.w) / page.rendered.w }
}

/** Host-px rect + font scale for a block on its page. scale = (rendered.w / box.w) / SCRATCH_REF_SCALE. */
export function blockScreenRect(
    b: ScratchBlock,
    page: PageInkPage,
    box: LogicalBox,
): { left: number; top: number; w: number; scale: number } {
    const k = page.rendered.w / box.w
    return {
        left: page.rendered.left + (b.x - box.x) * k,
        top: page.rendered.top + (b.y - box.y) * k,
        w: b.w * k,
        scale: k / SCRATCH_REF_SCALE,
    }
}

/** The block a click at host (hx, hy) on page `index`'s strip creates: x = click, w = to strip right
 *  edge minus SCRATCH_PAD, and when that is < SCRATCH_MIN_W, x shifts left (never left of x0 +
 *  SCRATCH_PAD) — including a click flush against the strip's own left edge, which clamps the same
 *  way rather than starting the block flush against the page. */
export function placeAt(
    index: number,
    page: PageInkPage,
    box: LogicalBox,
    hx: number,
    hy: number,
): Omit<ScratchBlock, 'id' | 'text'> {
    const p = screenToLogical({ x: hx, y: hy }, page.rendered, box)
    const { x0, x1 } = stripRangeLogical(page, box)
    const right = x1 - SCRATCH_PAD
    const left = Math.ceil(x0 + SCRATCH_PAD)
    let x = Math.max(left, Math.round(p.x))
    if (right - x < SCRATCH_MIN_W) {
        // Floor, so the shifted block keeps at least SCRATCH_MIN_W after rounding.
        x = Math.max(left, Math.floor(right - SCRATCH_MIN_W))
    }
    return {
        page: index,
        x,
        y: Math.round(p.y),
        w: Math.max(0, Math.floor(right - x)),
    }
}

/** Which page's strip contains host point (hx, hy), and the logical x/y there; null when none. */
export function hitStrip(
    pages: PageInkPage[],
    boxes: LogicalBox[],
    hx: number,
    hy: number,
): { page: number; x: number; y: number } | null {
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!
        const box = boxes[i]
        const m = page.marginW ?? 0
        if (!box || !(m > 0)) continue
        const r = page.rendered
        const left = r.left + r.w
        if (hx < left || hx > left + m || hy < r.top || hy > r.top + r.h)
            continue
        const p = screenToLogical({ x: hx, y: hy }, r, box)
        return { page: i, x: p.x, y: p.y }
    }
    return null
}

/** Where a dragged block lands. The POINTER (px, py) picks the strip (`hitStrip`); the block's
 *  dragged top-left (left, top — host px) becomes its new logical x/y on that page. x is clamped
 *  within `[x0 + SCRATCH_PAD, x1 - SCRATCH_PAD - w]` (the same pad `placeAt` respects), y is clamped
 *  to the page's own logical bounds `[box.y, box.y + box.h]` (never negative, never past the page),
 *  and w only ever SHRINKS to fit a strip narrower than the block (never grows it back) — down to
 *  SCRATCH_MIN_W when the strip has that much room, mirroring `placeAt`'s narrow-strip clamp. When
 *  the strip's available span (between the pads) is itself under SCRATCH_MIN_W — a strip wide enough
 *  to have a margin but too narrow to hold a readable block — this returns null the same as "not over
 *  any strip", rather than shrinking the block to near-zero width. Null = the caller snaps the block
 *  back. */
export function dropAt(
    pages: PageInkPage[],
    boxes: LogicalBox[],
    b: ScratchBlock,
    px: number,
    py: number,
    left: number,
    top: number,
): { page: number; x: number; y: number; w: number } | null {
    const hit = hitStrip(pages, boxes, px, py)
    if (!hit) return null
    const page = pages[hit.page]!
    const box = boxes[hit.page]!
    const p = screenToLogical({ x: left, y: top }, page.rendered, box)
    const { x0, x1 } = stripRangeLogical(page, box)
    const start = Math.ceil(x0 + SCRATCH_PAD)
    const right = x1 - SCRATCH_PAD
    const span = Math.max(0, right - start)
    if (span < SCRATCH_MIN_W) return null
    const w = Math.min(b.w, span)
    const x = Math.max(
        start,
        Math.min(Math.round(p.x), Math.floor(right - w)),
    )
    const y = Math.max(box.y, Math.min(Math.round(p.y), box.y + box.h))
    return { page: hit.page, x, y, w }
}
