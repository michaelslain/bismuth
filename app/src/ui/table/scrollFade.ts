// app/src/ui/table/scrollFade.ts — marks which sides of a table's sideways scroller hide more table,
// as `data-more-left` / `data-more-right` on the scroller, so global.css fades that edge. Without it
// a table cut off by its scroller reads as a broken table: overlay scrollbars stay hidden until a
// person already scrolls. Shared by the note editor's table widget and chat's table frame.

/** Recompute the scroller's `data-more-*` marks. Call on scroll and on resize. */
export function markScrollFade(scroller: HTMLElement) {
    const left = scroller.scrollLeft > 1
    const right =
        scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1
    scroller.toggleAttribute('data-more-left', left)
    scroller.toggleAttribute('data-more-right', right)
}

/** Keep `scroller`'s marks current; returns the disposer. */
export function watchScrollFade(scroller: HTMLElement): () => void {
    const update = () => markScrollFade(scroller)
    scroller.addEventListener('scroll', update, { passive: true })
    const ro =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(update)
    ro?.observe(scroller)
    if (scroller.firstElementChild) ro?.observe(scroller.firstElementChild)
    update()
    return () => {
        scroller.removeEventListener('scroll', update)
        ro?.disconnect()
    }
}
