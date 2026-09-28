// Pure logic behind SummariesFields: a table view's `summaries:` map (property id -> summary
// name) ⇄ one choice per visible column.
//
// The engine keys a footer cell by `canonicalId(prop)` (core/src/bases/query.ts), so `price`
// and `note.price` name the same column. Seeding matches on that; saving reuses whichever
// spelling the file already had, and keeps every entry for a column that is NOT currently
// visible — hiding a column must not silently delete its summary.
import { canonicalId } from '../../../core/src/bases/query'

/** The aggregations `summarize()` in core/src/bases/query.ts understands. Any other name
 *  renders an empty footer cell. */
export const SUMMARY_NAMES = [
    'Sum',
    'Average',
    'Min',
    'Max',
    'Count',
    'Empty',
    'Filled',
    'Unique',
] as const

/** column id -> chosen summary name ('' = none). */
export function seedSummaryChoices(
    summaries: Record<string, string> | undefined,
    columns: string[],
): Record<string, string> {
    const out: Record<string, string> = {}
    for (const col of columns) {
        const hit = Object.entries(summaries ?? {}).find(
            ([k]) => canonicalId(k) === canonicalId(col),
        )
        out[col] = hit ? hit[1] : ''
    }
    return out
}

/** Choices → the `summaries:` map, or undefined when empty. */
export function buildSummaries(
    existing: Record<string, string> | undefined,
    columns: string[],
    choices: Record<string, string>,
): Record<string, string> | undefined {
    const cols = new Set(columns.map(canonicalId))
    const out: Record<string, string> = {}
    // Entries for columns outside this list survive untouched.
    for (const [k, v] of Object.entries(existing ?? {}))
        if (!cols.has(canonicalId(k))) out[k] = v
    for (const col of columns) {
        const name = choices[col]
        if (!name) continue
        const key =
            Object.keys(existing ?? {}).find(
                k => canonicalId(k) === canonicalId(col),
            ) ?? col
        out[key] = name
    }
    return Object.keys(out).length ? out : undefined
}
