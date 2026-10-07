// Pure rule behind useOverflowHide: when a chip hides its meta row (location + link) because the
// row would spill past the chip's bottom, and when it brings it back. No framework imports.

/** `hidden` carries the chip size at the moment it latched: that size is what a resize is
 *  measured against. */
export type OverflowState =
    | { hidden: false }
    | { hidden: true; width: number; height: number }

export type OverflowMeasure = {
    /** The meta row's bottom edge inside the chip. Meaningless while hidden (the row is 0 tall). */
    metaBottom: number
    chipHeight: number
    /** The chip's current outer size. */
    width: number
    height: number
}

/** The next state for one measurement. A shown row that spills latches hidden at the chip's
 *  current size; a hidden row is released the moment the chip is a different size, and the
 *  remeasure that follows decides whether it fits at the new size (and latches again if not). */
export function stepOverflow(state: OverflowState, m: OverflowMeasure): OverflowState {
    if (state.hidden) {
        const resized = m.width !== state.width || m.height !== state.height
        return resized ? { hidden: false } : state
    }
    return m.metaBottom > m.chipHeight + 1
        ? { hidden: true, width: m.width, height: m.height }
        : state
}
