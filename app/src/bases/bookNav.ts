// app/src/bases/bookNav.ts
// Pure navigation maths for the book view: how big a page is in a pane, which layout the pane can
// hold, which leaf stays on screen when the layout changes, and what a key press means. No
// framework imports.
import {
    spreadFor,
    type BookLayout,
    type Spread,
} from '../../../core/src/bases/bookPages'

/** Narrowest a page may be before the pane drops to one page. */
export const PAGE_MIN_W = 280
/** Width over height of a page. */
export const PAGE_ASPECT = 3 / 4
/** A text page's width over height when the scans are no reading shape (a wide photo). */
export const TEXT_PAGE_ASPECT = 2 / 3

/** The shape of a text page: the scans' own when that is a reading page (portrait, 0.55 to 0.85),
 *  so switching between pages and text keeps the same sheet; else TEXT_PAGE_ASPECT. */
export function readingAspect(scans: number): number {
    return scans >= 0.55 && scans <= 0.85 ? scans : TEXT_PAGE_ASPECT
}
/** One odd photo cannot make a book unreadable: a page is never narrower or wider than this. */
export const PAGE_ASPECT_MIN = 0.5
export const PAGE_ASPECT_MAX = 1.6

/** A page aspect kept inside [PAGE_ASPECT_MIN, PAGE_ASPECT_MAX]; the default when not a number. */
export function clampAspect(aspect: number): number {
    if (!Number.isFinite(aspect) || aspect <= 0) return PAGE_ASPECT
    return Math.min(PAGE_ASPECT_MAX, Math.max(PAGE_ASPECT_MIN, aspect))
}

export type BookFit = {
    layout: BookLayout
    /** True when the pane cannot hold two pages at `PAGE_MIN_W` each. */
    spreadDisabled: boolean
    /** One page, CSS px. */
    pageSize: { w: number; h: number }
}

/** Fits the requested layout into `pane`: falls back to single when two pages would be narrower
 *  than `PAGE_MIN_W`, and scales the pages to the height or the width, whichever binds. */
export function fitBook(
    pane: { w: number; h: number },
    requested: BookLayout,
    pageAspect: number = PAGE_ASPECT,
): BookFit {
    const aspect = clampAspect(pageAspect)
    const spreadDisabled = pane.w < PAGE_MIN_W * 2
    const layout: BookLayout =
        requested === 'spread' && !spreadDisabled ? 'spread' : 'single'
    const pages = layout === 'spread' ? 2 : 1
    const w = Math.max(0, Math.min(pane.w / pages, pane.h * aspect))
    return { layout, spreadDisabled, pageSize: { w, h: w / aspect } }
}

/** The leaf to keep when the layout changes from `from` to `to`: the right page of the spread on
 *  screen (the only page, in single layout), so the page being read stays on screen. */
export function retargetLeaf(
    leaf: number,
    count: number,
    from: BookLayout,
    to: BookLayout,
): number {
    if (from === to) return leaf
    const s = spreadFor(leaf, count, from)
    return s.right ?? s.left ?? 0
}

/** +1 for the next-page binding, -1 for the previous-page binding, null for any other key.
 *  `match` is `matchesKeybinding`, injected so this stays framework-free. */
export function stepFromKey<E>(
    e: E,
    bindings: { next: string | undefined; prev: string | undefined },
    match: (e: E, setting: string | undefined) => boolean,
): 1 | -1 | null {
    if (match(e, bindings.next)) return 1
    if (match(e, bindings.prev)) return -1
    return null
}

/** The bar readout for the spread on screen: `page 1 // 48`, or `pages 2–3 // 48` for two pages. */
/** The page number under the book, the way a reading app prints it: `16–17 of 31` on a spread,
 *  `1 of 31` for a lone page. */
export function folioFor(spread: Spread, count: number): string {
    const { left, right } = spread
    if (left !== undefined && right !== undefined) return `${left + 1}–${right + 1} of ${count}`
    return `${(right ?? left ?? 0) + 1} of ${count}`
}

export function readoutFor(spread: Spread, count: number): string {
    const { left, right } = spread
    if (left !== undefined && right !== undefined)
        return `pages ${left + 1}–${right + 1} // ${count}`
    const only = right ?? left ?? 0
    return `page ${only + 1} // ${count}`
}
