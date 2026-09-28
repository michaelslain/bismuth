// Pure logic behind the settings panel's Columns list: which property ids a view shows, in
// what order — a view's `order:` ⇄ a list of {col, visible} toggles.
//
// Never-lose-data rule: every id already in `order:` stays in the list, even one the rows
// don't carry right now (a `formula.x`, a `note.`-prefixed spelling, a column with no values
// yet). The previous panel seeded only from row-derived columns, so saving silently dropped
// any `order:` entry it didn't recognise.
import { canonicalId } from '../../../core/src/bases/query'

export interface ColState {
    col: string
    visible: boolean
}

/** Seed the list: the view's `order` (visible, in order) then every other discovered column
 *  (hidden). With no `order`, every discovered column is visible ("no preference"). */
export function seedColumns(
    order: string[] | undefined,
    discovered: string[],
): ColState[] {
    if (!order || order.length === 0)
        return dedupe(discovered).map(col => ({ col, visible: true }))
    const out: ColState[] = []
    const seen = new Set<string>()
    for (const col of order) {
        if (seen.has(canonicalId(col))) continue
        seen.add(canonicalId(col))
        out.push({ col, visible: true })
    }
    for (const col of discovered) {
        if (seen.has(canonicalId(col))) continue
        seen.add(canonicalId(col))
        out.push({ col, visible: false })
    }
    return out
}

/** Keep `state`'s order + visibility, append any newly available column HIDDEN (a new formula
 *  column is not shown until the user ticks it — the same as the view would render it), and
 *  drop entries no longer available. */
export function mergeColumns(
    state: ColState[],
    available: string[],
): ColState[] {
    const avail = new Set(available.map(canonicalId))
    const kept = state.filter(s => avail.has(canonicalId(s.col)))
    const have = new Set(kept.map(s => canonicalId(s.col)))
    const added = dedupe(available)
        .filter(c => !have.has(canonicalId(c)))
        .map(col => ({ col, visible: false }))
    return [...kept, ...added]
}

/** The `order:` value for a list: its visible ids, in order. */
export function orderOf(state: ColState[]): string[] {
    return state.filter(s => s.visible).map(s => s.col)
}

/** Flip one column's visibility — refusing to hide the LAST visible one (an empty `order`
 *  means "show everything", so hiding the last column would paradoxically show them all). */
export function toggleColumn(state: ColState[], col: string): ColState[] {
    const visible = state.filter(s => s.visible).length
    return state.map(s =>
        s.col !== col || (s.visible && visible <= 1)
            ? s
            : { ...s, visible: !s.visible },
    )
}

function dedupe(cols: string[]): string[] {
    const seen = new Set<string>()
    return cols.filter(c => {
        const k = canonicalId(c)
        if (seen.has(k)) return false
        seen.add(k)
        return true
    })
}
