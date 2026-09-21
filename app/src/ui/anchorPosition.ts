// app/src/ui/anchorPosition.ts
// Pure positioning math for AnchoredPopover.tsx — no `window`/DOM reads in here, which is what
// makes it unit-testable headlessly (Solid components can't be mounted under this repo's test
// runner). Vertical twin of ui/popover/placeAnchored.ts's placeBelowOrAbove, extended with a
// resolved placement (so the caller can flip its own visual treatment) and horizontal clamping,
// which Select/DateFieldEditor never needed (their lists always sit flush with the trigger's left
// edge and are narrower than the viewport).

export type AnchorRect = { top: number; left: number; placement: 'below' | 'above' }

/** Where a `panel` of the given size should sit relative to `anchor`, inside `viewport`.
 *  `placement` is the PREFERRED side; it flips only when that side has no room and the other
 *  does. When neither side fits, the preferred side wins and the result is clamped inside the
 *  viewport (a panel taller than the viewport pins to the top edge). Horizontal position always
 *  starts at the anchor's left edge and clamps inside the viewport's width. */
export function computeAnchorRect(
    anchor: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
    panel: { width: number; height: number },
    viewport: { width: number; height: number },
    placement: 'below' | 'above' = 'below',
    gap = 4,
): AnchorRect {
    const fitsBelow = anchor.bottom + gap + panel.height <= viewport.height
    const fitsAbove = anchor.top - gap - panel.height >= 0

    let resolved: 'below' | 'above' = placement
    if (placement === 'below' && !fitsBelow && fitsAbove) resolved = 'above'
    else if (placement === 'above' && !fitsAbove && fitsBelow) resolved = 'below'

    const top = resolved === 'below' ? anchor.bottom + gap : anchor.top - gap - panel.height

    const clampedTop = Math.max(0, Math.min(top, viewport.height - panel.height))
    const left = Math.max(0, Math.min(anchor.left, viewport.width - panel.width))

    return { top: clampedTop, left, placement: resolved }
}
