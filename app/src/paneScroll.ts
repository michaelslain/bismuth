// app/src/paneScroll.ts
// The scroll half of app control's `scroll-pane` action (`bismuth app scroll`): find the element
// that scrolls a pane's content, move it, and report where it ended up.
//
// A pane's content is any view (a CodeMirror note, a base table, a PDF, an xterm), so there is no
// one component to ask. The pane's root element (`data-pane-leaf`, or `data-terminal-overlay` for a
// terminal, whose xterm lives in the overlay above the pane) is searched for its MAIN scroller: the
// largest descendant that actually overflows on the vertical axis and is styled to scroll. Each of
// those views listens to its scroller's native `scroll` event, so setting `scrollTop` drives them
// exactly as a wheel would.
import type { UiScrollOp, UiScrollPosition } from '../../core/src/uiControl'

/** One page is 90% of the visible height, so a line of context carries over between pages. */
export const PAGE_FRACTION = 0.9

/** The measurements a scroll decision needs, read off an element or faked in a test. */
export type ScrollMetrics = {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
}

/** Validate a wire `op`: `undefined` (read the position only), a `UiScrollOp`, or an error
 *  message naming what is wrong. */
export function parseScrollOp(raw: unknown): UiScrollOp | undefined | string {
    if (raw === undefined || raw === null) return undefined
    if (typeof raw !== 'object') return 'scroll op must be an object'
    const o = raw as Record<string, unknown>
    const keys = Object.keys(o)
    if (keys.length !== 1) return 'scroll op takes exactly one of by, pages, to'
    if ('by' in o)
        return typeof o.by === 'number' && Number.isFinite(o.by)
            ? { by: o.by }
            : 'by must be a number of pixels'
    if ('pages' in o)
        return typeof o.pages === 'number' && Number.isFinite(o.pages)
            ? { pages: o.pages }
            : 'pages must be a number'
    if ('to' in o) {
        if (o.to === 'top' || o.to === 'bottom') return { to: o.to }
        return typeof o.to === 'number' && o.to >= 0 && o.to <= 1
            ? { to: o.to }
            : 'to must be top, bottom or a fraction from 0 to 1'
    }
    return 'scroll op takes exactly one of by, pages, to'
}

/** The furthest `scrollTop` the element accepts. */
export function maxScroll(m: ScrollMetrics): number {
    return Math.max(0, m.scrollHeight - m.clientHeight)
}

/** Where `op` moves an element measuring `m`, clamped to [0, max]. */
export function targetTop(op: UiScrollOp, m: ScrollMetrics): number {
    const max = maxScroll(m)
    let top: number
    if ('by' in op) top = m.scrollTop + op.by
    else if ('pages' in op)
        top = m.scrollTop + op.pages * m.clientHeight * PAGE_FRACTION
    else if (op.to === 'top') top = 0
    else if (op.to === 'bottom') top = max
    else top = op.to * max
    return Math.round(Math.min(max, Math.max(0, top)))
}

/** The position reply for an element measuring `m`. */
export function position(
    m: ScrollMetrics,
): Omit<UiScrollPosition, 'leafId' | 'content'> {
    const max = maxScroll(m)
    const top = Math.round(m.scrollTop)
    return {
        top,
        max,
        height: Math.round(m.clientHeight),
        fraction: max === 0 ? 0 : Math.round((top / max) * 1000) / 1000,
    }
}

/** The subset of an element `pickScroller` reads; a real `HTMLElement` satisfies it. */
export type ScrollCandidate = ScrollMetrics & {
    clientWidth: number
}

/** The main scroller among `candidates`: the one with the largest visible area that overflows
 *  vertically and whose `overflow-y` lets it scroll. `overflowY` reads an element's computed value
 *  (injected so the choice is testable without a DOM). Ties keep document order, so an outer
 *  scroller wins over an equally-sized inner one. */
export function pickScroller<T extends ScrollCandidate>(
    candidates: Iterable<T>,
    overflowY: (el: T) => string,
): T | null {
    let best: T | null = null
    let bestArea = 0
    for (const el of candidates) {
        if (el.scrollHeight - el.clientHeight < 1) continue
        const o = overflowY(el)
        if (o !== 'auto' && o !== 'scroll' && o !== 'overlay') continue
        const area = el.clientHeight * el.clientWidth
        if (area > bestArea) {
            best = el
            bestArea = area
        }
    }
    return best
}

/** The main scroller inside `root` (the root itself included), or null when nothing in it
 *  scrolls. */
export function findScroller(root: HTMLElement): HTMLElement | null {
    const all = [root, ...root.querySelectorAll<HTMLElement>('*')]
    return pickScroller(all, el => getComputedStyle(el).overflowY)
}
