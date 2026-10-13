// app/src/shell/tabRailShift.ts
// The live reorder preview for a tab drag on the rail: while a tab is dragged over the rail, every
// row slides to the slot it will occupy once the drop lands, so the rows part and a gap opens at
// the drop slot before the pointer is released (the kanban's card drag does the same). Pure: it
// takes the current id order and the order the drop would produce, and returns each row's
// vertical offset in px.

/** The px offset for each row of `order`, given the order `next` a drop would produce and the
 *  distance between two row tops (`pitch`). A row not in `next` stays put. */
export function railShifts(
    order: readonly string[],
    next: readonly string[],
    pitch: number,
): number[] {
    const at = new Map(next.map((id, i) => [id, i]))
    return order.map((id, i) => {
        const j = at.get(id)
        return j === undefined ? 0 : (j - i) * pitch
    })
}
