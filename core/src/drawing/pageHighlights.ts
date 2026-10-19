// core/src/drawing/pageHighlights.ts
// Pure ops for in-place PDF text highlights, living on a binary's `.draw` sidecar alongside its
// ink (core/src/drawing/pageInk.ts owns that geometry; this owns the highlight rects). No DOM —
// a screen selection is converted to logical rects by app/src/preview/selectionRects.ts, which
// hands them to `addHighlight` below.
import { PDF_HIGHLIGHT_YELLOW } from '../theme/tokens'
import { ensurePages } from './pageInk'
import type { DrawingDoc, Highlight, HighlightRect } from './model'

/** 'hl' (the default, unset colour) resolves to the shared PDF highlight yellow
 *  (core/src/theme/tokens.ts) — a bright highlighter mark, not a UI category hue. A real hex
 *  passes through unchanged; painting a highlight translucent (so it reads over black text on a
 *  white page) is HighlightLayer's job, not this function's — this only resolves WHICH colour,
 *  not how opaque it renders. */
export function resolveHighlightColor(c: string): string {
    return c === 'hl' ? PDF_HIGHLIGHT_YELLOW : c
}

let idCounter = 0

/** A short, session-unique highlight id. Not a UUID — highlights never need to be globally
 *  unique, only unique within one sidecar, and `Date.now()` + a counter is enough for that
 *  while staying dependency-free. */
function makeHighlightId(): string {
    idCounter += 1
    return `hl-${Date.now().toString(36)}-${idCounter}`
}

/** Add one highlight (its rects — one per selected line, see `mergeLineRects`) to `page`,
 *  padding `doc` with empty pages as needed. A selection that resolved to no rects (e.g. it
 *  landed entirely off every page) is dropped rather than recording an empty highlight.
 *
 *  A selection that overlaps (or abuts, on the same line) an existing highlight of the same
 *  colour extends that highlight instead of stacking a second translucent mark over it: every
 *  touched highlight and the new rects become one highlight, keeping the first touched one's id
 *  and its place in the list, with the rects re-merged per line and the texts joined. A highlight
 *  of another colour loses the part the selection covers (`recolorUnder`), so highlighting over
 *  it in a new colour changes that part's colour. Pure: `doc` is never mutated. */
export function addHighlight(
    doc: DrawingDoc,
    page: number,
    rects: HighlightRect[],
    opts?: { c?: string; text?: string; id?: string },
): DrawingDoc {
    if (rects.length === 0) return doc
    const base = ensurePages(doc, page + 1)
    const pages = base.pages.slice()
    const c = opts?.c ?? 'hl'
    const existing = recolorUnder(pages[page]?.highlights ?? [], rects, c)
    const touched = existing.filter(
        h =>
            sameColor(h.c, c) && h.rects.some(a => rects.some(b => rectsTouch(a, b))),
    )
    if (touched.length === 0) {
        const highlight: Highlight = {
            id: opts?.id ?? makeHighlightId(),
            c,
            rects,
            ...(opts?.text ? { text: opts.text } : {}),
        }
        pages[page] = { ...pages[page], highlights: [...existing, highlight] }
        return { ...base, pages }
    }
    const fresh: Highlight = {
        id: '',
        c,
        rects,
        ...(opts?.text ? { text: opts.text } : {}),
    }
    const parts = [...touched, fresh].sort(
        (a, b) =>
            readingOrder(a.rects) - readingOrder(b.rects) ||
            a.rects[0]!.x - b.rects[0]!.x,
    )
    const text = parts.reduce<string | undefined>(
        (acc, h) =>
            h.text ? (acc ? joinOverlapping(acc, h.text) : h.text) : acc,
        undefined,
    )
    const merged: Highlight = {
        id: touched[0]!.id,
        c,
        rects: mergeLineRects(parts.flatMap(h => h.rects)),
        ...(text ? { text } : {}),
    }
    const highlights = existing.flatMap(h =>
        h === touched[0] ? [merged] : touched.includes(h) ? [] : [h],
    )
    pages[page] = { ...pages[page], highlights }
    return { ...base, pages }
}

/** Highlights of ANOTHER colour lose the part `rects` covers, so a selection highlighted in a new
 *  colour replaces the colour under it instead of stacking two translucent marks into a muddy
 *  third. Each covered line rect is cut to what lies left and right of the new rects on that line;
 *  a highlight cut down to nothing is dropped, and one that was cut drops its text, which no longer
 *  matches its rects. Untouched highlights come back as the same objects. */
function recolorUnder(
    existing: Highlight[],
    rects: HighlightRect[],
    c: string,
): Highlight[] {
    return existing.flatMap(h => {
        if (sameColor(h.c, c)) return [h]
        let cut = false
        const kept = h.rects.flatMap(r => {
            let pieces = [r]
            for (const n of rects) {
                pieces = pieces.flatMap(p => {
                    if (!rectsTouch(p, n, 0) || n.x + n.w <= p.x || n.x >= p.x + p.w) return [p]
                    cut = true
                    return [
                        { ...p, w: n.x - p.x },
                        { ...p, x: n.x + n.w, w: p.x + p.w - (n.x + n.w) },
                    ].filter(q => q.w > MIN_PIECE_W)
                })
            }
            return pieces
        })
        if (!cut) return [h]
        if (kept.length === 0) return []
        const { text: _text, ...rest } = h
        return [{ ...rest, rects: kept }]
    })
}

/** 'hl' and the yellow it resolves to are one colour; hex case never matters. */
function sameColor(a: string, b: string): boolean {
    return resolveHighlightColor(a).toLowerCase() === resolveHighlightColor(b).toLowerCase()
}

/** A sliver narrower than this (logical units) left beside a recoloured selection is dropped
 *  rather than kept as a hairline of the old colour. */
const MIN_PIECE_W = 2

/** True when `a` and `b` sit on the same text line (their vertical bands overlap by at least
 *  half the shorter one) and meet horizontally — overlapping, or with a gap of at most
 *  `gap`, so a selection that starts exactly where a highlight ends still extends it. */
function rectsTouch(a: HighlightRect, b: HighlightRect, gap = 2): boolean {
    const vOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
    if (vOverlap < Math.min(a.h, b.h) / 2) return false
    return a.x <= b.x + b.w + gap && b.x <= a.x + a.w + gap
}

/** The top of a highlight's first line, for ordering parts top to bottom. */
function readingOrder(rects: HighlightRect[]): number {
    return Math.min(...rects.map(r => r.y))
}

/** `a` then `b`, with the longest suffix of `a` that is also a prefix of `b` written once —
 *  two overlapping selections' texts joined into the text of their union. Whitespace is
 *  compared loosely, since a PDF selection's line breaks vary with where it starts. A seam
 *  shorter than three characters counts only on word edges. When one
 *  text already contains the other, the longer one is kept. */
function joinOverlapping(a: string, b: string): string {
    const norm = (t: string) => t.replace(/\s+/g, ' ')
    const na = norm(a)
    const nb = norm(b)
    if (na.includes(nb)) return a
    if (nb.includes(na)) return b
    // A drag can start mid-word, so a seam of 3+ characters counts anywhere; a shorter one only
    // on word edges, so `cat` + `tiger` never fuses on the shared t.
    const wordEdge = (t: string, i: number) =>
        i <= 0 || i >= t.length || t[i] === ' ' || t[i - 1] === ' '
    for (let k = Math.min(na.length, nb.length); k > 0; k--) {
        if (!na.endsWith(nb.slice(0, k))) continue
        if (k >= 3 || (wordEdge(na, na.length - k) && wordEdge(nb, k)))
            return na + nb.slice(k)
    }
    return `${na} ${nb}`
}

/** Remove the highlight `id` from `page`. A no-op (returns `doc` itself) when the page or the id
 *  doesn't exist, so a stale removal never triggers a spurious re-render/save. */
export function removeHighlight(
    doc: DrawingDoc,
    page: number,
    id: string,
): DrawingDoc {
    const target = doc.pages[page]
    if (!target?.highlights?.length) return doc
    const highlights = target.highlights.filter(h => h.id !== id)
    if (highlights.length === target.highlights.length) return doc
    const pages = doc.pages.slice()
    pages[page] = { ...pages[page], highlights }
    return { ...doc, pages }
}

function rectContains(r: HighlightRect, pt: { x: number; y: number }): boolean {
    return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h
}

/** The topmost (last-added) highlight on `page` whose rects contain `pt` (logical page
 *  coordinates), else null. "Topmost" mirrors z-order: later highlights paint over earlier
 *  ones, so a click on overlapping highlights should hit the one the user sees on top. */
export function highlightAt(
    doc: DrawingDoc | null,
    page: number,
    pt: { x: number; y: number },
): Highlight | null {
    const highlights = doc?.pages[page]?.highlights
    if (!highlights?.length) return null
    for (let i = highlights.length - 1; i >= 0; i--) {
        const h = highlights[i]!
        if (h.rects.some(r => rectContains(r, pt))) return h
    }
    return null
}

/** Collapse the many per-span client rects a browser selection yields on one visual line into
 *  one rect per line: rects whose vertical band (top and bottom, each within `tolerance` px)
 *  matches the rect merged so far join it as a union; a rect starting a new band starts a new
 *  merged rect. Zero-area rects (a span collapsed by a soft line-break, or a selection edge that
 *  landed on nothing) are dropped first. Rects are sorted by `y` then `x` first, so every rect
 *  belonging to one visual line is contiguous in the scan regardless of the order the caller
 *  passed them in (a selection's per-span rects are not guaranteed to arrive top-to-bottom). */
export function mergeLineRects(
    rects: HighlightRect[],
    tolerance = 2,
): HighlightRect[] {
    const nonEmpty = rects.filter(r => r.w > 0 && r.h > 0)
    if (nonEmpty.length === 0) return []
    const sorted = [...nonEmpty].sort((a, b) => a.y - b.y || a.x - b.x)
    const merged: HighlightRect[] = []
    for (const r of sorted) {
        const last = merged[merged.length - 1]
        const sameLine =
            last !== undefined &&
            Math.abs(r.y - last.y) <= tolerance &&
            Math.abs(r.y + r.h - (last.y + last.h)) <= tolerance
        if (last && sameLine) {
            const x0 = Math.min(last.x, r.x)
            const y0 = Math.min(last.y, r.y)
            const x1 = Math.max(last.x + last.w, r.x + r.w)
            const y1 = Math.max(last.y + last.h, r.y + r.h)
            merged[merged.length - 1] = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
        } else {
            merged.push({ ...r })
        }
    }
    return merged
}

/** A selection's text as one line of prose: the PDF's line breaks become spaces, and a word the
 *  layout hyphenated across a line break (`noto-\nriously`) is joined back up. A hyphen before an
 *  uppercase letter or a digit stays, since that is more often a real compound than a split. */
export function highlightPlainText(text: string): string {
    return text
        .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, '$1$2')
        .replace(/-\s*\n\s*/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
}

/** One highlight as an agent or a person reads it: 1-based page, colour, and its text. */
export interface HighlightEntry {
    page: number
    id: string
    color: string
    text: string | null
}

/** Every highlight in `doc`, page by page, top to bottom (then left to right) within a page —
 *  the order a reader meets them, not the order they were made. `text` is null for a highlight
 *  saved without its selected text. */
export function listHighlights(doc: DrawingDoc): HighlightEntry[] {
    const top = (h: Highlight) => h.rects[0] ?? { x: 0, y: 0 }
    return doc.pages.flatMap((pg, i) =>
        [...(pg.highlights ?? [])]
            .sort((a, b) => top(a).y - top(b).y || top(a).x - top(b).x)
            .map(h => ({
                page: i + 1,
                id: h.id,
                color: resolveHighlightColor(h.c),
                text: h.text ? highlightPlainText(h.text) : null,
            })),
    )
}
