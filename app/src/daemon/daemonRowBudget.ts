// app/src/daemon/daemonRowBudget.ts
// How many rows each of the daemon page's right-column sections may show so that, at rest, all
// four fit in the column with no scrollbar. Pure — DaemonOverview measures its own height and the
// row pitch, hands this the budget in row units, and passes each section its limit.
//
// Every section is guaranteed its `floor` (the caller sets it to at least the rows that need
// attention, so a limit never hides a problem). Rows left over go round-robin, one at a time, to
// the sections that still have more to show — so a long log cannot starve a short cron list, and
// a short list never wastes rows it does not need. A section that ends up cut off spends one row
// on its `+N more // show` line, which is accounted for here.

export type SectionNeed = {
    /** Rows the section has in total. */
    total: number
    /** Rows it must show whatever the budget (attention rows, and a minimum so it never reads as
     *  empty). Clamped to `total`. */
    floor: number
}

/** `undefined` = no limit: the section shows every row. */
export type RowLimit = number | undefined

/** One section's limit per entry of `needs`, in the same order. `available` is the whole budget
 *  in row units, `+N more` lines included. */
export function allocateRows(available: number, needs: SectionNeed[]): RowLimit[] {
    const totals = needs.map(n => Math.max(0, n.total))
    const sum = totals.reduce((a, b) => a + b, 0)
    if (sum <= available) return totals.map(() => undefined)

    const limits = needs.map((n, i) => Math.min(totals[i], Math.max(0, n.floor)))
    const cut = (i: number) => limits[i] < totals[i]
    // Each cut-off section pays one row for its `+N more` line.
    const used = () =>
        limits.reduce((a, l, i) => a + l + (cut(i) ? 1 : 0), 0)

    let grew = true
    while (grew) {
        grew = false
        for (let i = 0; i < limits.length; i++) {
            if (!cut(i)) continue
            // Growing to the last hidden row also frees its more-line, so it costs nothing extra.
            const cost = limits[i] + 1 === totals[i] ? 0 : 1
            if (used() + cost > available) continue
            limits[i]++
            grew = true
        }
    }
    return limits.map((l, i) => (cut(i) ? l : undefined))
}

/** Whole row units that fit in `heightPx` once `overheadPx` (headings, gaps, empty lines) is
 *  taken out. Never negative. */
export function rowUnits(heightPx: number, overheadPx: number, pitchPx: number): number {
    if (pitchPx <= 0) return 0
    return Math.max(0, Math.floor((heightPx - overheadPx) / pitchPx))
}
