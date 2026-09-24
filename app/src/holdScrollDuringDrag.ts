/** The nearest ancestor of `el` that actually scrolls vertically, or null. Computed style, not a
 *  class name — the scroller belongs to whichever shell hosts the tree. */
export function scrollParent(el: HTMLElement | undefined): HTMLElement | null {
    for (let p = el?.parentElement; p; p = p.parentElement) {
        const oy = getComputedStyle(p).overflowY
        if (
            (oy === 'auto' || oy === 'scroll') &&
            p.scrollHeight > p.clientHeight
        )
            return p
    }
    return null
}

/** How long after the release a scroll the user did not make is reverted. */
const SETTLE_MS = 600

/** Pin `scroller`'s scrollTop from a row press until shortly after the pointer is released.
 *  Dropping a sidebar row into a note or chat moves focus into that surface on release, and the
 *  desktop app's WebKit jumps the sidebar to the top as it goes — the user loses their place in
 *  the tree on every drag. Only scrolls the user did not make are reverted: a wheel moves the pin. */
export default function holdScrollDuringDrag(scroller: HTMLElement): void {
    let top = scroller.scrollTop
    let released = false
    const onWheel = () => {
        // Let the wheel's own scroll land, then adopt it as the new pin.
        requestAnimationFrame(() => (top = scroller.scrollTop))
    }
    const onScroll = () => {
        if (scroller.scrollTop !== top && !wheeling) scroller.scrollTop = top
    }
    let wheeling = false
    let wheelTimer: ReturnType<typeof setTimeout> | undefined
    const markWheel = () => {
        wheeling = true
        clearTimeout(wheelTimer)
        wheelTimer = setTimeout(() => (wheeling = false), 150)
        onWheel()
    }
    const stop = () => {
        scroller.removeEventListener('scroll', onScroll)
        scroller.removeEventListener('wheel', markWheel)
        window.removeEventListener('pointerup', end, true)
        window.removeEventListener('pointercancel', end, true)
    }
    const end = () => {
        if (released) return
        released = true
        onScroll()
        setTimeout(stop, SETTLE_MS)
    }
    scroller.addEventListener('scroll', onScroll)
    scroller.addEventListener('wheel', markWheel, { passive: true })
    window.addEventListener('pointerup', end, true)
    window.addEventListener('pointercancel', end, true)
}
