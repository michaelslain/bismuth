// Pure: which day a task row sits on, and how late it is. No framework imports, so the
// chip component stays presentational and this stays unit-testable headlessly.
//
// The two behavioural rules of the tasks calendar live HERE and ONLY here:
//   1. Placement: `scheduled`, falling back to `due` when there is no scheduled date.
//      An explicit `dateField` pins the view to one field and turns the fallback off.
//   2. Overdue: an unfinished task whose placed day is before today renders on TODAY,
//      carrying how many days late it is. A resolved task always stays on its own day.
import type { Row } from '../../../core/src/bases/types'

export interface PlacedTask {
    row: Row
    placed: string
    late: number
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** True only when `v` is a string shaped like an ISO date (`YYYY-MM-DD`). This checks
 *  SHAPE only, not that the date is a real calendar day — the parser already rejects
 *  impossible dates upstream, and that is not this module's job. `note.*` arrives over
 *  HTTP as JSON from user-authored frontmatter, so `undefined`, `null`, `''` and a
 *  wrong type are ordinary wire values, not edge cases — every one of them fails this
 *  check and is therefore treated as absent. */
function isIsoDate(v: unknown): v is string {
    return typeof v === 'string' && ISO_DATE.test(v)
}

/** The ISO date a row sits on, or undefined when it has nothing VALID to place it on —
 *  this is the only shape it ever returns; there is no "present but unusable" case that
 *  leaks through. With an explicit `dateField` that field wins outright — no fallback
 *  applies, so a row whose named field is missing, `null`, the wrong type, or a
 *  malformed string is unplaced. Otherwise this READS `note.placed` (already computed
 *  by taskRow.ts as `scheduled ?? due`) rather than recomputing the fallback, so the
 *  filter language and the grid can never disagree about where a task sits. The
 *  fallback — `scheduled` then `due`, each validated the same way — is used only when
 *  `note.placed` itself is not a valid ISO string, e.g. a row that did not come from
 *  the tasks source. */
export function placedDate(row: Row, dateField?: string): string | undefined {
    if (dateField) {
        const v = row.note[dateField]
        return isIsoDate(v) ? v : undefined
    }
    const placed = row.note.placed
    if (isIsoDate(placed)) return placed
    const scheduled = row.note.scheduled
    if (isIsoDate(scheduled)) return scheduled
    const due = row.note.due
    return isIsoDate(due) ? due : undefined
}

/** Whole days `today` is past `placed`. ISO y/m/d are diffed via Date.UTC, never a
 *  local `Date`, so a daylight-saving boundary can't shift the count by a day. */
export function daysLate(placed: string, today: string): number {
    return utcDayNumber(today) - utcDayNumber(placed)
}

function utcDayNumber(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number)
    return Date.UTC(y, m - 1, d) / 86400000
}

/** Buckets rows by the day they render on. An unresolved row whose placed day is
 *  strictly before `today` is re-keyed onto `today` carrying its `late` count; a
 *  resolved row, or one placed on or after today, stays on its own `placed` day with
 *  `late: 0`. A row with no placed date (per `placedDate`) is dropped entirely. */
export function placeRows(rows: Row[], today: string, dateField?: string): Map<string, PlacedTask[]> {
    const buckets = new Map<string, PlacedTask[]>()
    for (const row of rows) {
        const placed = placedDate(row, dateField)
        if (placed === undefined) continue
        const overdue = !row.note.resolved && placed < today
        const day = overdue ? today : placed
        const late = overdue ? daysLate(placed, today) : 0
        const bucket = buckets.get(day)
        const entry: PlacedTask = { row, placed, late }
        if (bucket) bucket.push(entry)
        else buckets.set(day, [entry])
    }
    return buckets
}
