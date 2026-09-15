// app/src/preview/selectionRects.ts
// Pure client-rect -> page mapping for HighlightLayer.tsx. A text selection's
// `Range.getClientRects()` are viewport ("client") pixels; a page's PageInkPage.rendered is
// expressed in the shared HOST coordinate space PageInk/HighlightLayer both paint against (see
// PageInk.tsx's header). This module bridges the two: which page a client rect visually sits on
// top of, and that rect converted into the page's own logical space (core/src/drawing/pageInk.ts
// — the same space strokes and highlights live in). No DOM types beyond a structural rect shape,
// so it stays unit-testable with plain objects.
import {
    screenToLogical,
    type LogicalBox,
} from '../../../core/src/drawing/pageInk'
import type { HighlightRect } from '../../../core/src/drawing/model'
import type { PageInkPage } from './PageInk'

/** The subset of a `DOMRect` this module needs — a plain object satisfies it, so a test never
 *  has to construct a real DOMRect. */
export type ClientRectLike = {
    left: number
    top: number
    width: number
    height: number
}

/** Bucket `clientRects` (client/viewport px) by the page they visually sit on — the page whose
 *  `rendered` rect (host px) contains the client rect's CENTRE, once shifted into host space by
 *  `hostOrigin` (the host element's own `getBoundingClientRect()` top-left) — and convert each
 *  into that page's logical coordinates via `screenToLogical`. A rect whose centre lands on no
 *  page (e.g. a selection edge that fell in the gap between two stacked pages) is dropped, not
 *  clamped to the nearest one. `boxOf(i)` resolves page `i`'s logical box (pageBoxFor in the
 *  caller — kept as a callback here so this module never needs a whole DrawingDoc). */
export function rectsToPages(
    clientRects: ClientRectLike[],
    hostOrigin: { left: number; top: number },
    pages: PageInkPage[],
    boxOf: (i: number) => LogicalBox,
): Map<number, HighlightRect[]> {
    const out = new Map<number, HighlightRect[]>()
    for (const cr of clientRects) {
        if (cr.width <= 0 || cr.height <= 0) continue
        const left = cr.left - hostOrigin.left
        const top = cr.top - hostOrigin.top
        const cx = left + cr.width / 2
        const cy = top + cr.height / 2
        const pageIndex = pages.findIndex(p => {
            const r = p.rendered
            return (
                cx >= r.left &&
                cx <= r.left + r.w &&
                cy >= r.top &&
                cy <= r.top + r.h
            )
        })
        if (pageIndex === -1) continue
        const page = pages[pageIndex]!
        const box = boxOf(pageIndex)
        const topLeft = screenToLogical({ x: left, y: top }, page.rendered, box)
        // One scale for both axes (pageInk's own contract — a page renders at its own aspect
        // ratio, and so does its logical box), so the rect's size converts with the same factor
        // its top-left corner did.
        const k = box.w / page.rendered.w
        const rect: HighlightRect = {
            x: topLeft.x,
            y: topLeft.y,
            w: cr.width * k,
            h: cr.height * k,
        }
        const existing = out.get(pageIndex)
        if (existing) existing.push(rect)
        else out.set(pageIndex, [rect])
    }
    return out
}
