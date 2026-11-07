// app/src/ui/popover/placeAnchored.ts
// Shared bottom-edge flip logic for anchored/cursor-positioned popovers (ContextMenu, Select).
// Pure — no `window` reads inside; the caller passes `viewportH`, which is what makes this
// unit-testable headlessly (Solid components can't be mounted under this repo's test runner).

export const EDGE_GAP = 6

/** Viewport-relative top for a surface of height `h` whose natural top is `y`.
 *  Below when it fits; flipped ABOVE `flipFrom` when it does not; clamped inside the
 *  viewport when neither side fits: a surface taller than the viewport, or an anchor that is
 *  itself outside it (a window shrunk under an open menu).
 *  `flipFrom` is the anchor's TOP edge (the surface's bottom lands `gap` above it);
 *  omit it for a cursor-positioned menu, where the anchor is a point and `y` is it. */
export function placeBelowOrAbove(opts: {
    y: number
    h: number
    viewportH: number
    flipFrom?: number
    gap?: number
}): number {
    const { y, h, viewportH, flipFrom, gap = EDGE_GAP } = opts
    if (h <= 0) return y // not measured yet — first frame paints at the natural position
    if (y + h <= viewportH - EDGE_GAP) return y
    const above = flipFrom !== undefined ? flipFrom - h - gap : y - h
    if (above >= EDGE_GAP && above + h <= viewportH - EDGE_GAP) return above
    return Math.max(EDGE_GAP, viewportH - h - EDGE_GAP)
}

/** Viewport-relative left for a surface of width `w` whose natural left is `x`.
 *  The horizontal twin of placeBelowOrAbove: right of `x` when it fits; flipped so its RIGHT
 *  edge lands on `flipFrom` (default `x`, the cursor) when it does not; clamped inside the
 *  viewport when neither side fits — including an anchor that is itself outside the viewport (a
 *  window shrunk under an open menu). A submenu passes its parent's left edge as `flipFrom`. */
export function placeRightOrLeft(opts: {
    x: number
    w: number
    viewportW: number
    flipFrom?: number
}): number {
    const { x, w, viewportW, flipFrom = x } = opts
    if (w <= 0) return x // not measured yet — first frame paints at the natural position
    if (x + w <= viewportW - EDGE_GAP) return x
    const left = flipFrom - w
    if (left >= EDGE_GAP && left + w <= viewportW - EDGE_GAP) return left
    return Math.max(EDGE_GAP, viewportW - w - EDGE_GAP)
}
