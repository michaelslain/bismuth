// app/src/ui/tooltipPlacement.ts
// Where TooltipHost puts its bubble. Pure: no framework or `window` reads; the caller passes the
// anchor rect, the measured bubble size and the viewport. Reuses the popover edge rules
// (placeAnchored.ts) rather than a second positioning model.
import { EDGE_GAP, placeBelowOrAbove } from './popover/placeAnchored'

export type TooltipPlacement = { top: number; left: number; side: 'below' | 'above' }

/** Centred on the anchor, `gap` below its bottom edge; flipped `gap` above its top edge when it
 *  does not fit below; clamped `EDGE_GAP` inside the viewport horizontally. */
export function placeTooltip(opts: {
    anchor: { top: number; bottom: number; left: number; width: number }
    size: { w: number; h: number }
    viewport: { w: number; h: number }
    gap: number
}): TooltipPlacement {
    const { anchor, size, viewport, gap } = opts
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
