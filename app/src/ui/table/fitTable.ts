// app/src/ui/table/fitTable.ts — keeps a table inside its frame. Cells keep whole words (global.css's
// "Markdown tables"), so a table with many columns of long words can be wider than a narrow pane even
// at its narrowest. Rather than spill out past the frame, such a table is marked `data-squeezed`,
// which lets its cells break inside words too: the table wraps to fit, and words split only when
// whole words cannot fit. Shared by the note editor's table widget and chat's table frame. A note
// table extended with `∞`, or one whose columns a person dragged, scrolls on purpose, so the caller's
// `when` turns the fitting off for it.

/** Re-decide whether `table` has to squeeze to fit `frame`. */
export function fitTable(
    frame: HTMLElement,
    table: HTMLTableElement,
    when: () => boolean = () => true,
) {
    table.removeAttribute('data-squeezed')
    if (!when()) return
    // whole words first; only a table that still overflows its frame squeezes
    if (frame.scrollWidth > frame.clientWidth + 1)
        table.setAttribute('data-squeezed', '')
}

/** Keep `table` fitted while `container` (the full width the frame may take) or the table changes
 *  size; returns the disposer. */
export function watchFitTable(
    frame: HTMLElement,
    table: HTMLTableElement,
    container: Element,
    when?: () => boolean,
): () => void {
    const update = () => fitTable(frame, table, when)
    const ro =
        typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(update)
    ro?.observe(container)
    ro?.observe(table)
    update()
    return () => ro?.disconnect()
}
