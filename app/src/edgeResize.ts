// app/src/edgeResize.ts
// Width arithmetic for the panel edge handles (shell/EdgeHandle) — pure, no framework imports.
// The bounds are READ from the settings schema rather than restated, so dragging can never produce
// a width the schema would reject or the `.settings` lint would flag.
import { SETTINGS_SCHEMA } from '../../core/src/schema/settingsSchema'
import type { SchemaEntry } from '../../core/src/schema/types'

/** The appearance widths an edge drag writes. */
export type EdgeWidthKey = 'sidebarWidth' | 'tabRailWidth'

/** Pixels either side of the default width within which a drag snaps onto it — enough to catch
 *  the line as it passes, small enough that a deliberate near-default width is still reachable. */
export const SNAP_DISTANCE = 12

function widthEntry(key: EdgeWidthKey): SchemaEntry {
    const section = SETTINGS_SCHEMA.appearance as SchemaEntry
    const type = section.type
    const entry =
        typeof type === 'object' && type.kind === 'object'
            ? type.fields[key]
            : undefined
    if (!entry) throw new Error(`appearance.${key} is not in the settings schema`)
    return entry
}

/** The schema's `[min, max]` for one appearance width. */
export function widthBounds(key: EdgeWidthKey): [number, number] {
    const entry = widthEntry(key)
    if (entry.min === undefined || entry.max === undefined)
        throw new Error(`appearance.${key} has no min/max in the settings schema`)
    return [entry.min, entry.max]
}

/** The schema default for one appearance width — the snap point a drag sticks to. */
export function defaultWidth(key: EdgeWidthKey): number {
    const value = widthEntry(key).default
    if (typeof value !== 'number')
        throw new Error(`appearance.${key} has no numeric default in the settings schema`)
    return value
}

/** A drag's width: the width at press time plus the pointer's travel, rounded and clamped, then
 *  pulled onto the schema default when it lands within SNAP_DISTANCE of it — so the panel's stock
 *  width is a detent the line catches on, and dragging back to "where it was" is exact.
 *  `grow` is which pointer direction widens the panel — +1 for a panel on the left (its line moves
 *  right as it grows), -1 for one on the right. */
export function dragWidth(
    key: EdgeWidthKey,
    startWidth: number,
    dx: number,
    grow: 1 | -1,
): number {
    const [min, max] = widthBounds(key)
    const width = Math.min(max, Math.max(min, Math.round(startWidth + grow * dx)))
    const snap = defaultWidth(key)
    return Math.abs(width - snap) <= SNAP_DISTANCE ? snap : width
}
