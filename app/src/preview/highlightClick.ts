// The click that deletes a highlight, shared by the PDF preview, the book's page boxes and the
// book's text mode. While the pointer is over a highlight the whole page shows the delete cursor
// (`html[data-highlight-hover]`, a rule in global.css, since the element under the pointer is
// pdf.js's text layer or a page that is not the highlight's own). A plain click deletes it, but
// only once the double-click window has passed with no second press: a double-click selects a
// word, and a drag selects text, never deleting.

/** How long a click waits for a second press before it deletes. */
export const DOUBLE_CLICK_MS = 300

/** Pointer travel under which a press and release are a click, not a drag. */
export const CLICK_SLOP = 4

/** Shows (true) or clears (false) the delete cursor over the whole document. */
export function setHighlightCursor(on: boolean): void {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    if (on) root.setAttribute('data-highlight-hover', '')
    else root.removeAttribute('data-highlight-hover')
}

/** A click that runs only when it is a lone click: no press came shortly before it (it is not the
 *  second or third click of a multi-click) and none follows within `ms`. Call `press()` on every
 *  pointer press, before `schedule()` on its release. */
export function singleClick(ms = DOUBLE_CLICK_MS, now: () => number = () => performance.now()) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastPress = -Infinity
    let multi = false
    const cancel = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
    }
    return {
        press() {
            const t = now()
            multi = t - lastPress < ms
            lastPress = t
            cancel()
        },
        schedule(fn: () => void) {
            cancel()
            if (multi) return
            timer = setTimeout(() => {
                timer = undefined
                fn()
            }, ms)
        },
        cancel,
        pending: () => timer !== undefined,
    }
}

/** True when a press at `down` and a release at `up` (client px) are a click, not a drag. */
export function isClick(down: { x: number; y: number }, up: { x: number; y: number }): boolean {
    return Math.hypot(up.x - down.x, up.y - down.y) < CLICK_SLOP
}
