// app/src/preview/pdfAnnotHighlights.ts
// The pdf.js side of PDF highlights: turn the annotation objects `page.getAnnotations()` returns
// into Bismuth `Highlight`s (the same ids and rects `readPdfHighlights` in
// core/src/drawing/pdfHighlights.ts produces for the same file), and hide pdf.js's own painting of
// them so HighlightLayer is the only thing that draws a highlight.
//
// The id / geometry / colour functions are INJECTED (`PdfHighlightDeps`) and fetched lazily by
// `loadHighlightDeps`, so the conversion stays testable with stand-ins.
import type { Highlight, HighlightRect } from '../../../core/src/drawing/model'
import { PDF_HIGHLIGHT_YELLOW } from '../../../core/src/theme/tokens'

/** Mirrors `PdfPageGeom` in core/src/drawing/pdfHighlights.ts: `view` is pdf.js's `page.view`. */
export type PdfPageGeom = {
    view: [number, number, number, number]
    rotate: number
}

/** The conversion contract, exact header signatures of core/src/drawing/pdfHighlights.ts. */
export type PdfHighlightDeps = {
    pdfHighlightId: (page: number, quads: ArrayLike<number>, color: string) => string
    quadsToRects: (quads: ArrayLike<number>, g: PdfPageGeom) => HighlightRect[]
    rgbToHex: (rgb: ArrayLike<number>, scale: 1 | 255) => string
}

/** The fields of a pdf.js annotation this module reads. */
export type PdfAnnot = {
    subtype: string
    id?: string
    quadPoints?: ArrayLike<number> | null
    color?: ArrayLike<number> | null
}

// A /Highlight with no /C: the same default the core reader applies.
const DEFAULT_COLOR = PDF_HIGHLIGHT_YELLOW.toLowerCase()

/** Every `/Highlight` of one page as a Bismuth highlight; `page` is 0-based. */
export function highlightsFromAnnotations(
    annots: PdfAnnot[],
    page: number,
    g: PdfPageGeom,
    deps: PdfHighlightDeps,
): Highlight[] {
    const out: Highlight[] = []
    for (const a of annots) {
        if (a.subtype !== 'Highlight' || !a.quadPoints || a.quadPoints.length < 8) continue
        const c =
            a.color && a.color.length >= 3
                ? deps.rgbToHex(a.color, 255)
                : DEFAULT_COLOR
        out.push({
            id: deps.pdfHighlightId(page, a.quadPoints, c),
            c,
            rects: deps.quadsToRects(a.quadPoints, g),
        })
    }
    return out
}

/** The page proxy surface this module touches. */
type AnnotPage = {
    view: number[]
    rotate: number
    getAnnotations: () => Promise<PdfAnnot[]>
}

/** The document's annotation storage, as far as hiding needs it. */
export type HideStorage = {
    setValue: (key: string, value: Record<string, unknown>) => void
}

/** Marks every `/Highlight` of `page` as not viewable in `storage`. pdf.js's worker reads
 *  `annotationStorage.get(id)?.noView` in `mustBeViewed`, so a render with
 *  `AnnotationMode.ENABLE_STORAGE` skips exactly these and paints every other annotation kind.
 *  Idempotent. Returns the page's annotations so the caller can reuse the read. */
export async function hideHighlightPainting(
    page: Pick<AnnotPage, 'getAnnotations'>,
    storage: HideStorage,
): Promise<PdfAnnot[]> {
    const annots = await page.getAnnotations()
    for (const a of annots) {
        if (a.subtype === 'Highlight' && a.id) storage.setValue(a.id, { noView: true })
    }
    return annots
}

/** Reads every page's highlights (index = page). */
export async function readDocHighlights(
    pages: AnnotPage[],
    deps: PdfHighlightDeps,
    hide?: HideStorage,
): Promise<Highlight[][]> {
    return Promise.all(
        pages.map(async (p, i) => {
            const annots = hide
                ? await hideHighlightPainting(p, hide)
                : await p.getAnnotations()
            const view = p.view
            const g: PdfPageGeom = {
                view: [view[0], view[1], view[2], view[3]],
                rotate: p.rotate,
            }
            return highlightsFromAnnotations(annots, i, g, deps)
        }),
    )
}

/** The core conversion functions, imported lazily so core's drawing module stays out of the
 *  initial chunk. */
export async function loadHighlightDeps(): Promise<PdfHighlightDeps> {
    const m = await import('../../../core/src/drawing/pdfHighlights')
    return {
        pdfHighlightId: m.pdfHighlightId,
        quadsToRects: m.quadsToRects,
        rgbToHex: m.rgbToHex,
    }
}
