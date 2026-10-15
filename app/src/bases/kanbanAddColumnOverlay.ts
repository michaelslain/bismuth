// Where KanbanAddColumn places its name input while editing: BESIDE the trigger, which stays visible
// as `[+]`. x belongs to the ghost's flex row (the field follows the trigger's right edge at
// --sp-2, whatever the bracket geometry), so the offset's `left` is 0; y is matched on the glyph's
// vertical centre. Pure geometry — the component reads the three measurements off its own tree and
// hands them here — instead of a pixel literal that silently goes stale.

/** A box in viewport coordinates (a `getBoundingClientRect()` subset). */
export type Box = { left: number; top: number; height: number }

/** The input's own inset from its border box to its text: left = padding + border, top =
 *  padding + border, contentHeight = the content box a single-line input centres its text in. */
export type InputInset = { left: number; top: number; contentHeight: number }

export type OverlayOrigin = { left: number; top: number }

/**
 * The field's offset from its in-flow position (`position: relative`). x: 0 — the flex row already
 * puts the field --sp-2 right of the trigger's right edge. y: the field is top-anchored in the
 * ghost (a refusal line under it must not re-centre it), and a single-line input centres its text
 * in its content box, so the two are matched on the glyph's vertical CENTRE.
 */
export function overlayOrigin(
    ghost: Box,
    glyph: Box,
    inset: InputInset,
): OverlayOrigin {
    return {
        left: 0,
        top:
            glyph.top +
            glyph.height / 2 -
            ghost.top -
            inset.top -
            inset.contentHeight / 2,
    }
}

/** The computed-style fields `inputInset` reads (a `CSSStyleDeclaration` subset, so a test can pass
 *  a plain object). Values are CSS lengths like `12px`. */
export type InsetStyle = {
    paddingLeft: string
    paddingTop: string
    paddingBottom: string
    borderLeftWidth: string
    borderTopWidth: string
    borderBottomWidth: string
}

/** An input's `InputInset` from its computed style and its border-box height: text starts after
 *  padding + border on the left and top, and the content box is what is left of the height once
 *  the top and bottom padding + border are taken off. */
export function inputInset(
    cs: InsetStyle,
    borderBoxHeight: number,
): InputInset {
    const px = (v: string) => parseFloat(v) || 0
    const top = px(cs.paddingTop) + px(cs.borderTopWidth)
    const bottom = px(cs.paddingBottom) + px(cs.borderBottomWidth)
    return {
        left: px(cs.paddingLeft) + px(cs.borderLeftWidth),
        top,
        contentHeight: borderBoxHeight - top - bottom,
    }
}
