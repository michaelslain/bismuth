// The property ids a set of resolved rows offers as columns: every note key seen, in first-seen
// order, with `file.name` in front when any row has a file name. One copy for the query builder
// and the base settings panel.
import type { Row } from '../../../core/src/bases/types'

/** Note columns present across the resolved rows. */
export function columnsOf(rows: Row[]): string[] {
    const set = new Set<string>()
    let hasName = false
    for (const r of rows) {
        Object.keys(r.note).forEach(k => set.add(k))
        if (r.file?.name) hasName = true
    }
    const cols = [...set]
    return hasName ? ['file.name', ...cols] : cols
}
