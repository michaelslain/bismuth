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
 *  landed entirely off every page) is dropped rather than recording an empty highlight. Pure:
 *  `doc` is never mutated. */
export function addHighlight(
    doc: DrawingDoc,
    page: number,
    rects: HighlightRect[],
    opts?: { c?: string; text?: string; id?: string },
): DrawingDoc {
    if (rects.length === 0) return doc
    const base = ensurePages(doc, page + 1)
    const pages = base.pages.slice()
    const existing = pages[page]?.highlights ?? []
    const highlight: Highlight = {
        id: opts?.id ?? makeHighlightId(),
        c: opts?.c ?? 'hl',
        rects,
        ...(opts?.text ? { text: opts.text } : {}),
    }
    pages[page] = { ...pages[page], highlights: [...existing, highlight] }
    return { ...base, pages }
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
