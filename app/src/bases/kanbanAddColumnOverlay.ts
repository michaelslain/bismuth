// Where KanbanAddColumn places its name input so the input's text lands exactly on the resting
// trigger's "column" glyph. Pure geometry — the component reads the three measurements off its own
// tree and hands them here — so the placement follows whatever the trigger's leading geometry is
// (bracket glyph, icon size setting, gaps, the fixed --h-control height that centres the label)
// instead of a pixel literal that silently goes stale when any of those change.

/** A box in viewport coordinates (a `getBoundingClientRect()` subset). */
export type Box = { left: number; top: number; height: number }

/** The input's own inset from its border box to its text: left = padding + border, top =
 *  padding + border, contentHeight = the content box a single-line input centres its text in. */
export type InputInset = { left: number; top: number; contentHeight: number }

export type OverlayOrigin = { left: number; top: number }

/**
 * The overlay's `left`/`top` relative to `ghost` (its containing block). x: the input's text starts
 * at its left inset, so the overlay starts that far before the glyph. y: a single-line input centres
 * its text in its content box and the trigger centres its label in its own box, so the two are
 * matched on the glyph's vertical CENTRE — which holds for any font, since both render in the one UI
 * face at the one size.
 */
export function overlayOrigin(
    ghost: Box,
    glyph: Box,
    inset: InputInset,
): OverlayOrigin {
    return {
        left: glyph.left - ghost.left - inset.left,
        top:
            glyph.top +
            glyph.height / 2 -
            ghost.top -
            inset.top -
            inset.contentHeight / 2,
    }
}
