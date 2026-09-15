// app/src/preview/modeToggleRow.ts
// Where the PDF bar's HIGHLIGHT / DRAW / SCRATCH group goes: in the bar's single row, or on a
// second row under it. Pure — PreviewView measures the DOM, this decides — so the rule is testable
// and cannot flip-flop.
//
// ROOM-BASED, NOT A WIDTH TIER: the answer depends on what is actually in row 1 (the filename's
// minimum, FIT, BOOKMARKS, a page readout, the native actions) at the user's own font size, which
// no fixed container-query breakpoint can know.
//
// The two states measure different things, and the thresholds are chosen so that a decision never
// undoes itself on the next measurement:
//   • In row 1, the group is allowed to shrink (and clips) once the filename has given all it can,
//     so "does not fit" is simply the group's content overflowing its own box.
//   • On row 2, the question is whether the filename could give up enough width for the group AND
//     the gap it brings with it. If it can, moving back leaves the filename at or above its
//     minimum, so the group does not overflow and stays put.

export type ToggleRowMeasure = {
    /** The group is currently on the second row. */
    wrapped: boolean
    /** The group's content width — all three toggles plus their gaps (its natural width). */
    groupScrollW: number
    /** The group's own box width where it sits now. */
    groupClientW: number
    /** Row 1's leading region (the filename): its current width… */
    leadW: number
    /** …and the narrowest it may become. */
    leadMinW: number
    /** The spacing the group adds beside its row-1 neighbours when it sits there. */
    joinGap: number
}

/** Sub-pixel layout noise that must never count as "does not fit". */
const EPS = 0.5

export function togglesOnSecondRow(m: ToggleRowMeasure): boolean {
    if (!m.wrapped) return m.groupScrollW > m.groupClientW + EPS
    return m.groupScrollW + m.joinGap > m.leadW - m.leadMinW + EPS
}
