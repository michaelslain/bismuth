// Pointer-gesture maths for the table's header row — column reorder and column resize. Pure: the
// component reads rects/pointer positions from the DOM and hands numbers in, so every rule here
// is unit-tested without a browser.

export type HRect = { left: number; right: number }

/** Index of the header whose horizontal span holds `x`, or null when the pointer is outside all
 *  of them (the last match wins on a shared edge, as the reorder cue always has). */
export function columnAtX(rects: HRect[], x: number): number | null {
    let over: number | null = null
    rects.forEach((r, i) => {
        if (x >= r.left && x <= r.right) over = i
    })
    return over
}

/** `cols` with the column at `from` moved to slot `to`; null when nothing would move. */
export function moveColumn(
    cols: string[],
    from: number,
    to: number | null,
): string[] | null {
    if (to === null || to === from) return null
    const arr = [...cols]
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    return arr
}

/** Which column a pointerdown on header `idx` would resize, or null outside a resize zone. A
 *  column boundary is shared by two cells, so it is grabbable from BOTH sides: the right edge of
 *  column i and the left edge of column i+1 both resize column i. The visible separator is
 *  centred on the boundary and overhangs into the next cell, so without the left-edge branch
 *  clicking that half would start a reorder instead. */
export function resizeTarget(
    idx: number,
    rect: HRect,
    x: number,
    grabPx: number,
    enabled: boolean,
): number | null {
    if (!enabled) return null
    if (rect.right - x <= grabPx) return idx
    if (idx > 0 && x - rect.left <= grabPx) return idx - 1
    return null
}

/** Every column's width for the start of a resize: the stored width where there is one, else
 *  the rendered header width — so the switch to fixed layout never reflows an untouched column. */
export function seedWidths(
    cols: string[],
    stored: Record<string, number>,
    measured: number[],
): Record<string, number> {
    const seed: Record<string, number> = { ...stored }
    cols.forEach((c, i) => {
        if (seed[c] == null && measured[i] != null) seed[c] = measured[i]
    })
    return seed
}

/** The widths after dragging `col` from `startX` to `x`: only that column changes, clamped to
 *  `minW` and rounded to whole pixels. */
export function resizedWidths(
    seed: Record<string, number>,
    col: string,
    startW: number,
    startX: number,
    x: number,
    minW: number,
): Record<string, number> {
    return { ...seed, [col]: Math.max(minW, Math.round(startW + (x - startX))) }
}
