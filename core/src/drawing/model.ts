export const PAGE_W = 816
export const PAGE_H = 1056

/** The fixed logical width ink coordinates are stored in — the editor's reading column. Strokes
 *  scale by `contentWidth / INK_LOGICAL_W` at paint/pointer time so pane-width changes and
 *  sidebar toggles are absorbed without touching the persisted geometry. */
export const INK_LOGICAL_W = 680

/** A caller-chosen render box for ONE page of strokes, painted with NO paper ground — the
 *  note-ink path (app/src/export/inkHtml.ts, which rasterizes each ```draw fence for the
 *  html/pdf/png export). Sizes are logical units of the same space the strokes are stored in,
 *  so `width` is INK_LOGICAL_W for note ink: CSS scaling that raster to the export's reading
 *  column then reproduces the editor's own `contentWidth / INK_LOGICAL_W` scale for free, at
 *  whatever width the column happens to be. Omitted — the historical shape — means a full
 *  PAGE_W x PAGE_H sheet WITH its paper background, which is right for a `.draw` file and
 *  wrong for an annotation, whose opaque ground would hide the words it is drawn on. */
export interface InkBox {
    width: number
    height: number
}

export type PaperBg = 'blank' | 'lines' | 'grid' | 'dots'
export type Tool = 'pen' | 'hl'
export interface Stroke {
    t: Tool
    c: string
    w: number
    straight?: boolean
    pts: number[]
}
// A placed raster image, in the page's 816×1056 logical coordinate space. `src` is a
// self-contained `data:image/...;base64,...` URL so the `.draw` stays fully portable (the
// headless CLI export needs zero asset resolution). Drawn UNDER the ink (background-ish), so
// you can both import a picture into a sketch and annotate a photo by stroking over it.
export interface ImageEl {
    src: string
    x: number
    y: number
    w: number
    h: number
}
/** A text highlight on a source page (in-place PDF annotation), in the same logical page space
 *  as strokes (core/src/drawing/pageInk.ts). One rect per line of selected text. */
export interface HighlightRect {
    x: number
    y: number
    w: number
    h: number
}
export interface Highlight {
    id: string
    /** A hex colour, or 'hl' = the default highlight colour (resolved by pageHighlights.ts). */
    c: string
    rects: HighlightRect[]
    /** The selected text, kept for listing/search. */
    text?: string
}
/** A user bookmark on a source page (0-based). */
export interface Bookmark {
    id: string
    page: number
    label: string
}
/** Extra drawable paper to the right of every source page, as a fraction of that page's
 *  rendered width. */
export interface PageMargin {
    right: number
}
export interface Page {
    strokes: Stroke[]
    images?: ImageEl[]
    /** In-place PDF text highlights on this page. */
    highlights?: Highlight[]
}
export interface Paper {
    bg: PaperBg
}
export interface DrawingDoc {
    v: 1
    kind: 'drawing'
    paper: Paper
    pages: Page[]
    /** In-place PDF bookmarks (a binary's sidecar only). */
    bookmarks?: Bookmark[]
    /** In-place PDF drawing margin (a binary's sidecar only). */
    margin?: PageMargin
}
// `border`/`borderSoft` feed the paper ground (grid/dot/ruled) so it tracks the theme's
// own hairline tokens (bismuth-design/ascii-extended/PORTING.md §2c) instead of a derived wash.
export interface ThemeColors {
    bg: string
    fg: string
    border: string
    borderSoft: string
}

export function emptyDoc(): DrawingDoc {
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'grid' },
        pages: [{ strokes: [] }],
    }
}

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))

/** Round stroke geometry for compact persistence: x/y to whole px, the packed pressure byte
 *  clamped to 0-255. Shared by `.draw` (roundDoc) and note-ink (inkCommit.ts) serialization.
 *  GENERIC so a caller's extra fields survive in the TYPE as well as at runtime — the body
 *  already spreads `...s`, so a subtype's extra fields aren't erased by a bare `Stroke[]`
 *  return. */
export function roundStrokes<T extends Stroke>(strokes: T[]): T[] {
    return strokes.map(s => ({
        ...s,
        pts: s.pts.map((n, i) => (i % 3 === 2 ? clampByte(n) : Math.round(n))),
    }))
}

export function roundDoc(doc: DrawingDoc): DrawingDoc {
    return {
        ...doc,
        pages: doc.pages.map(pg => ({
            strokes: roundStrokes(pg.strokes),
            // Carry images through (rebuilding the page as `{ strokes }` only would silently
            // strip them on save). Round the geometry; NEVER touch `src` (the data URL).
            ...(pg.images
                ? {
                      images: pg.images.map(im => ({
                          ...im,
                          x: Math.round(im.x),
                          y: Math.round(im.y),
                          w: Math.round(im.w),
                          h: Math.round(im.h),
                      })),
                  }
                : {}),
        })),
    }
}

export function serializeDoc(doc: DrawingDoc): string {
    return JSON.stringify(roundDoc(doc))
}

export function parseDoc(text: string): DrawingDoc {
    const o = JSON.parse(text)
    if (!o || o.kind !== 'drawing' || !Array.isArray(o.pages)) {
        throw new Error('not a drawing document')
    }
    return o as DrawingDoc
}
