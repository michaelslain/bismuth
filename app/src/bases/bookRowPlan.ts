// app/src/bases/bookRowPlan.ts
// The row writes that turn a book base's rows into the order the page sorter shows. Rows are
// addressed by position in the base file, which shifts after every write, so the plan walks a copy
// of the file's row ids and emits each delete and move at the position it has at that moment.
// Rows that are not pages (a note row, a row with no page) stay in their places; pages fill the
// places pages held, in the new order.

export type RowOp = { op: 'delete'; index: number } | { op: 'move'; from: number; to: number }

/** Deletes for `removed`, last first so no index shifts under a later one; returns the rows left. */
export function planDeletes<T>(rows: readonly T[], removed: ReadonlySet<T>): { ops: RowOp[]; rows: T[] } {
    const left = [...rows]
    const ops: RowOp[] = []
    for (let i = left.length - 1; i >= 0; i--) {
        if (!removed.has(left[i])) continue
        ops.push({ op: 'delete', index: i })
        left.splice(i, 1)
    }
    return { ops, rows: left }
}

/** Moves that put `order` (every page row, in the new order) into the places page rows hold in
 *  `rows`; rows not in `order` keep theirs. */
export function planMoves<T>(rows: readonly T[], order: readonly T[]): RowOp[] {
    const want = new Set(order)
    // the file as it should end: every row where it is, pages swapped for the new order
    let k = 0
    const desired = rows.map(id => (want.has(id) ? order[k++] : id))
    const sim = [...rows]
    const ops: RowOp[] = []
    for (let i = 0; i < desired.length; i++) {
        if (sim[i] === desired[i]) continue
        const from = sim.indexOf(desired[i])
        if (from < 0) continue
        sim.splice(from, 1)
        sim.splice(i, 0, desired[i])
        ops.push({ op: 'move', from, to: i })
    }
    return ops
}

/** Applies ops to a copy of `rows`: what the base file holds after them. */
export function applyRowOps<T>(rows: readonly T[], ops: readonly RowOp[]): T[] {
    const out = [...rows]
    for (const o of ops) {
        if (o.op === 'delete') out.splice(o.index, 1)
        else {
            const [m] = out.splice(o.from, 1)
            out.splice(o.to, 0, m)
        }
    }
    return out
}
