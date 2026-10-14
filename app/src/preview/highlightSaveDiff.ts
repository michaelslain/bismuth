// app/src/preview/highlightSaveDiff.ts
// Pure helpers for saving a PDF's highlights INTO the PDF (createAnnotationStore.ts): the diff
// between the highlight set last saved/loaded and the set the user now sees, and the inverse of
// that diff for applying an edit list to a freshly read set. Highlights are matched by id; a
// highlight whose id stayed but whose rects or colour changed (an extend-on-overlap) is a remove
// of the old one plus an add of the new one, which is what `applyPdfHighlightEdits` understands.
import type { Highlight } from '../../../core/src/drawing/model'
import type { PdfHighlightEdits } from '../../../core/src/drawing/pdfHighlights'
import { resolveHighlightColor } from '../../../core/src/drawing/pageHighlights'

/** Logical-space tolerance: a rect that round-tripped through quad points is the same rect. */
const EPS = 0.01

/** Same colour ('hl' and the hex it resolves to are the same), same rects within `EPS`. */
export function sameHighlight(a: Highlight, b: Highlight): boolean {
    if (
        resolveHighlightColor(a.c).toLowerCase() !==
        resolveHighlightColor(b.c).toLowerCase()
    )
        return false
    if (a.rects.length !== b.rects.length) return false
    return a.rects.every((r, i) => {
        const o = b.rects[i]!
        return (
            Math.abs(r.x - o.x) <= EPS &&
            Math.abs(r.y - o.y) <= EPS &&
            Math.abs(r.w - o.w) <= EPS &&
            Math.abs(r.h - o.h) <= EPS
        )
    })
}

const byId = (hs: Highlight[] | undefined): Map<string, Highlight> => {
    const m = new Map<string, Highlight>()
    for (const h of hs ?? []) m.set(h.id, h)
    return m
}

/** What turns the `saved` PDF set (index = page) into `next`. Empty edits mean nothing to write. */
export function diffHighlights(
    saved: Highlight[][],
    next: Highlight[][],
): PdfHighlightEdits {
    const edits: PdfHighlightEdits = { add: [], remove: [] }
    const pages = Math.max(saved.length, next.length)
    for (let page = 0; page < pages; page++) {
        const before = byId(saved[page])
        const after = byId(next[page])
        for (const [id, h] of before) {
            const now = after.get(id)
            if (!now || !sameHighlight(h, now)) edits.remove.push({ page, id })
        }
        for (const [id, h] of after) {
            const was = before.get(id)
            if (!was || !sameHighlight(was, h))
                edits.add.push({ page, highlight: h })
        }
    }
    return edits
}

export const isEmptyEdits = (e: PdfHighlightEdits): boolean =>
    e.add.length === 0 && e.remove.length === 0

/** `edits` applied to a set read from the PDF: removes drop their id, adds append unless the id is
 *  already there. Pure; the input is never mutated. */
export function applyEditsToPages(
    pages: Highlight[][],
    edits: PdfHighlightEdits,
): Highlight[][] {
    const out = pages.map(p => p.slice())
    for (const { page, id } of edits.remove) {
        if (out[page]) out[page] = out[page]!.filter(h => h.id !== id)
    }
    for (const { page, highlight } of edits.add) {
        while (out.length <= page) out.push([])
        if (!out[page]!.some(h => h.id === highlight.id))
            out[page]!.push(highlight)
    }
    return out
}
