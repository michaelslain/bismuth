// The composer's whole contract. Views that render a tasks grid pass ONE `TaskComposeProps`
// down through their cells rather than growing five more flat props per level — see
// TaskCellComposer.tsx (the presentational component this type is the contract for) and
// TaskChip.tsx (the chip the composer sits under and must visually match).
//
// No framework imports on purpose: every calendar view (month/week/day, and eventually list)
// imports this type to type its own props, and none of them should have to pull Solid in just
// to describe "where is the composer open right now".

/** One place a composed task can be written to — a source note (sourced base) or a category
 *  (an own-rows base). `id` is what `target`/`setTarget` carry: a vault path for a sourced
 *  target, a category name (or `''` for "no category") for an owned-rows target. */
export type TaskComposeTarget = {
    id: string
    label: string
    color?: string
}

/** The composer's whole contract, passed as ONE prop through the view components so a tasks
 *  grid does not grow five more flat props per level. */
export type TaskComposeProps = {
    /** ISO date whose cell has the composer open, or null for none. */
    date: string | null
    /** Basename of where a commit will land, shown under the input ("General Tasks") — the
     *  label of the currently-picked `target`. */
    destination: string
    /** Resolved CSS colour of the view's defaultCategory. Undefined → the composer's marker
     *  keeps its default `--text-muted`. */
    color?: string
    /** Every destination a composed task could be written to — one per source note (a sourced
     *  base) or one per category (an own-rows base). Empty only when there is truly nowhere to
     *  write (a sourced base with no `taskFile` and no rows yet). */
    targets: TaskComposeTarget[]
    /** The currently-picked target's `id`. */
    target: string
    setTarget: (id: string) => void
    open: (date: string) => void
    commit: (date: string, text: string) => void
    cancel: () => void
}
