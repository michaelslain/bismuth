// The composer's whole contract. Views that render a tasks grid pass ONE `TaskComposeProps`
// down through their cells rather than growing five more flat props per level — see
// TaskCellComposer.tsx (the presentational component this type is the contract for) and
// TaskChip.tsx (the chip the composer sits under and must visually match).
//
// No framework imports on purpose: every calendar view (month/week/day, and eventually list)
// imports this type to type its own props, and none of them should have to pull Solid in just
// to describe "where is the composer open right now".

/** The composer's whole contract, passed as ONE prop through the view components so a tasks
 *  grid does not grow five more flat props per level. */
export type TaskComposeProps = {
    /** ISO date whose cell has the composer open, or null for none. */
    date: string | null
    /** Basename of where a commit will land, shown under the input ("General Tasks"). */
    destination: string
    /** Resolved CSS colour of the view's defaultCategory. Undefined → no band. */
    color?: string
    open: (date: string) => void
    commit: (date: string, text: string) => void
    cancel: () => void
}
