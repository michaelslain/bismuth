import type { Row } from '../../../core/src/bases/types'
import { api } from '../api'
import { canWriteStoredRow, storedNote } from './taskWrite'

// Pure helpers behind KanbanView's "only roll back what THIS call added" write paths — extracted
// so the identity/grouping logic is unit-testable without a component. A whole-snapshot rollback
// (restoring `prevOrder`/`prevRemoved`/`prevPending` wholesale) clobbers overlay entries another
// concurrent action wrote during this call's await; these helpers instead undo exactly the keys
// this call itself is responsible for, and only while they still hold the value this call wrote.

/** Groups `items` by `.path`, preserving first-seen path order and each path's item order. Feeds
 * a batched write (e.g. `rowUpdateMany`) that must issue one call per distinct target file rather
 * than assuming every update shares the board's own path. */
export function groupUpdatesByPath<T extends { path: string }>(
    items: T[],
): Map<string, T[]> {
    const out = new Map<string, T[]>()
    for (const item of items) {
        const list = out.get(item.path)
        if (list) list.push(item)
        else out.set(item.path, [item])
    }
    return out
}

/** Writes `statusKey = value` onto every row (`undefined` removes the key, so the card falls into
 * the no-value lane). Two write targets, split exactly as `dropCard` does it: STORED rows go one
 * `rowUpdateMany` per distinct file (a `source:` base's rows carry their own file, never the
 * board's), NOTE rows go `setProperties` (or one `deleteProperty` each when clearing). All
 * requests target distinct paths so they run concurrently; the first failure rejects. */
export async function writeStatus(
    rows: Row[],
    statusKey: string,
    value: string | undefined,
): Promise<void> {
    const storedRows = rows.filter(canWriteStoredRow)
    const noteRows = rows.filter(r => !canWriteStoredRow(r))
    const jobs: Promise<unknown>[] = []
    if (storedRows.length > 0) {
        const items = storedRows.map(r => {
            const note = { ...storedNote(r) }
            if (value === undefined) delete note[statusKey]
            else note[statusKey] = value
            return { path: r.file.path, index: r.index!, note }
        })
        for (const [path, group] of groupUpdatesByPath(items))
            jobs.push(
                api.rowUpdateMany(
                    path,
                    group.map(g => ({ index: g.index, note: g.note })),
                ),
            )
    }
    if (noteRows.length > 0) {
        if (value === undefined)
            for (const r of noteRows)
                jobs.push(api.deleteProperty(r.file.path, statusKey))
        else
            jobs.push(
                api.setProperties(
                    noteRows.map(r => ({
                        path: r.file.path,
                        key: statusKey,
                        value,
                    })),
                ),
            )
    }
    await Promise.all(jobs)
}

/** `current` minus every key whose value is STILL the exact object this call wrote into
 * `written` (`===`, not deep-equal) — a key another action has since overwritten or deleted is
 * left alone, because rolling it back would clobber that other action's own in-flight state. */
export function rollbackPending<V>(
    current: Record<string, V>,
    written: Record<string, V>,
): Record<string, V> {
    const out = { ...current }
    for (const key of Object.keys(written)) {
        if (out[key] === written[key]) delete out[key]
    }
    return out
}

/** `current` minus `added` — a new Set, so the caller's existing Set (and its identity for any
 * other reader) is untouched. `added === null` means this call never added anything, so the
 * current set is returned AS-IS (no copy, no-op). */
export function rollbackRemoved(
    current: Set<string>,
    added: string | null,
): Set<string> {
    if (added === null) return current
    const out = new Set(current)
    out.delete(added)
    return out
}
