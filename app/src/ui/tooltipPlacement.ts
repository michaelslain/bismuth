// app/src/ui/tooltipPlacement.ts
// Where TooltipHost puts its bubble. Pure: no framework or `window` reads; the caller passes the
// anchor rect, the measured bubble size and the viewport. Reuses the popover edge rules
// (placeAnchored.ts) rather than a second positioning model.
import { EDGE_GAP, placeBelowOrAbove } from './popover/placeAnchored'

/** Where a holder asks its bubble to open: `below` (the default) or `right`, for a control whose
 *  row below is taken by something the bubble must not cover (a section heading). */
export type TooltipSide = 'below' | 'right'

export type TooltipPlacement = {
    top: number
    left: number
    side: 'below' | 'above' | 'right'
}

/** Centred on the anchor, `gap` below its bottom edge; flipped `gap` above its top edge when it
 *  does not fit below; clamped `EDGE_GAP` inside the viewport horizontally.
 *  `prefer: 'right'` opens it `gap` right of the anchor, centred on the anchor's row, and falls
 *  back to below/above when the viewport has no room on the right. */
export function placeTooltip(opts: {
    anchor: { top: number; bottom: number; left: number; width: number }
    size: { w: number; h: number }
    viewport: { w: number; h: number }
    gap: number
    prefer?: TooltipSide
}): TooltipPlacement {
    const { anchor, size, viewport, gap } = opts
    if (opts.prefer === 'right') {
        const left = anchor.left + anchor.width + gap
        if (left + size.w <= viewport.w - EDGE_GAP) {
            const centred = (anchor.top + anchor.bottom) / 2 - size.h / 2
            const maxTop = viewport.h - size.h - EDGE_GAP
            const top = Math.max(EDGE_GAP, Math.min(centred, maxTop))
            return { top, left, side: 'right' }
        }
    }
    const top = placeBelowOrAbove({
        y: anchor.bottom + gap,
        h: size.h,
        viewportH: viewport.h,
        flipFrom: anchor.top,
        gap,
    })
    const centred = anchor.left + anchor.width / 2 - size.w / 2
    const maxLeft = viewport.w - size.w - EDGE_GAP
    const left = Math.max(EDGE_GAP, Math.min(centred, maxLeft))
    return { top, left, side: top >= anchor.bottom ? 'below' : 'above' }
}
