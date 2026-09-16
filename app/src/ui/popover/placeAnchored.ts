// app/src/ui/popover/placeAnchored.ts
// Shared bottom-edge flip logic for anchored/cursor-positioned popovers (ContextMenu, Select).
// Pure — no `window` reads inside; the caller passes `viewportH`, which is what makes this
// unit-testable headlessly (Solid components can't be mounted under this repo's test runner).

export const EDGE_GAP = 6

/** Viewport-relative top for a surface of height `h` whose natural top is `y`.
 *  Below when it fits; flipped ABOVE `flipFrom` when it does not; clamped inside the
 *  viewport as a last resort for a surface taller than the viewport.
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
    if (above >= EDGE_GAP) return above
    return Math.max(EDGE_GAP, viewportH - h - EDGE_GAP)
}
