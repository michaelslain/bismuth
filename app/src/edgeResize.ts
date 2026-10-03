// app/src/edgeResize.ts
// Width arithmetic for the panel edge handles (shell/EdgeHandle) — pure, no framework imports.
// The bounds are READ from the settings schema rather than restated, so dragging can never produce
// a width the schema would reject or the `.settings` lint would flag.
import { SETTINGS_SCHEMA } from '../../core/src/schema/settingsSchema'
import type { SchemaEntry } from '../../core/src/schema/types'

/** The appearance widths an edge drag writes. */
export type EdgeWidthKey = 'sidebarWidth' | 'tabRailWidth'

/** The schema's `[min, max]` for one appearance width. */
export function widthBounds(key: EdgeWidthKey): [number, number] {
    const section = SETTINGS_SCHEMA.appearance as SchemaEntry
    const type = section.type
    const entry =
        typeof type === 'object' && type.kind === 'object'
            ? type.fields[key]
            : undefined
    if (!entry || entry.min === undefined || entry.max === undefined)
        throw new Error(`appearance.${key} has no min/max in the settings schema`)
    return [entry.min, entry.max]
}

/** A drag's width: the width at press time plus the pointer's travel, rounded and clamped.
 *  `grow` is which pointer direction widens the panel — +1 for a panel on the left (its line moves
 *  right as it grows), -1 for one on the right. */
export function dragWidth(
    key: EdgeWidthKey,
    startWidth: number,
    dx: number,
    grow: 1 | -1,
): number {
    const [min, max] = widthBounds(key)
    return Math.min(max, Math.max(min, Math.round(startWidth + grow * dx)))
}
