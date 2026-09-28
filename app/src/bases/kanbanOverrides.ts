// The optimistic-echo state machine behind a kanban card's meta values: a just-committed value
// paints at once as an OVERRIDE on the row, and is dropped again when a refetched row confirms it.
// Pure (no framework imports) so KanbanCard.tsx only holds the signal.
import type { BaseConfig, Row } from '../../../core/src/bases/types'
import {
    coercePropertyValue,
    propertyType,
} from '../../../core/src/bases/properties'

export type Overrides = Record<string, unknown>

/** A property id with its `note.` namespace stripped — the key `row.note` is stored under. */
export function bareKey(id: string): string {
    return id.startsWith('note.') ? id.slice(5) : id
}

/** `row` with every pending override written into `row.note`. `resolveProperty`'s bare and
 *  `note.`-namespaced lookups both read `row.note`, so this covers every id shape. */
export function applyOverrides(row: Row, ov: Overrides): Row {
    const ids = Object.keys(ov)
    if (ids.length === 0) return row
    const note = { ...row.note } as Record<string, unknown>
    for (const id of ids) note[bareKey(id)] = ov[id]
    return { ...row, note }
}

/** Drop every override the live `row` already reflects. Returns `cur` itself when none did. */
export function reconcileOverrides(cur: Overrides, row: Row): Overrides {
    let next: Overrides | null = null
    for (const id of Object.keys(cur)) {
        const live = (row.note as Record<string, unknown>)[bareKey(id)] ?? null
        if (JSON.stringify(live) === JSON.stringify(cur[id] ?? null)) {
            next ??= { ...cur }
            delete next[id]
        }
    }
    return next ?? cur
}

export function withOverride(cur: Overrides, id: string, value: unknown): Overrides {
    return { ...cur, [id]: value }
}

/** The value to store for `id`: through the base's declared type when there is one (#100),
 *  `null` for "cleared". */
export function coerceMeta(config: BaseConfig, id: string, value: unknown): unknown {
    const t = propertyType(config, id)
    return (t ? coercePropertyValue(t, value) : value) ?? null
}
