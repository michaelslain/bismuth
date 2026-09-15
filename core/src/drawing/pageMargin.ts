// core/src/drawing/pageMargin.ts
// Pure helpers for a sidecar's `margin` (core/src/drawing/model.ts's `PageMargin`) — extra
// drawable paper to the right of every source page, as a fraction of that page's rendered
// width. app/src/preview/PageInk.tsx turns the ratio into host px per page (`marginW`); this
// module owns the ratio itself, so the on/off toggle and its default live in one place.
import type { DrawingDoc } from './model'

/** The ratio a fresh "show margin" toggle turns on: 40% of the page's own rendered width — the
 *  page keeps 71% of the fit-width column (1 / 1.4) instead of shrinking to 62.5%. */
export const DEFAULT_MARGIN_RATIO = 0.4

/** The doc's margin ratio, or 0 when there is none (no `margin` key, or a non-finite value —
 *  never let a corrupt sidecar produce NaN/Infinity math downstream). Clamped to [0, 2]: 0 is
 *  "off", and doubling the page's own width is already more scratch space than anyone needs. */
export function marginRatioOf(doc: DrawingDoc | null): number {
    const r = doc?.margin?.right
    if (typeof r !== 'number' || !Number.isFinite(r)) return 0
    return Math.max(0, Math.min(2, r))
}

/** `doc` with its margin ratio set to `ratio`. A ratio `<= 0` REMOVES the `margin` key entirely
 *  (rather than storing a `{ right: 0 }` that would round-trip as a no-op forever) — mirrors
 *  `roundDoc`'s treatment of an absent `images` array. Never mutates `doc`. */
export function setMarginRatio(doc: DrawingDoc, ratio: number): DrawingDoc {
    if (ratio <= 0) {
        const { margin: _margin, ...rest } = doc
        return rest as DrawingDoc
    }
    return { ...doc, margin: { right: ratio } }
}
