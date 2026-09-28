// Pure Select-option helpers shared by the Bases settings fields and editors. The option type
// itself is ui/Select's — re-exported so callers import both from one place.
import { VIEW_TYPES } from '../../../core/src/bases/types'
import { baseOf } from '../../../core/src/linkTarget'
import type { SelectOption } from '../ui/Select'

export type { SelectOption }

/** Options with `current` kept even when the list lacks it. An undefined or empty current is
 *  ignored. `label` shapes the appended entry (default: the value itself). */
export function withCurrent(
    options: SelectOption[],
    current: string | undefined,
    label: (v: string) => string = v => v,
): SelectOption[] {
    if (!current || options.some(o => o.value === current)) return options
    return [...options, { value: current, label: label(current) }]
}

/** Every view kind, labelled by its own name. */
export const VIEW_KIND_OPTIONS: SelectOption[] = VIEW_TYPES.map(v => ({
    value: v,
    label: v,
}))

/** Destination notes as options: value is the vault path (a caller storing a `[[link]]`
 *  converts it), label is the explicit label else the basename, detail is the folder. */
export function destinationOptions(
    notes: { path: string; label?: string; color?: string }[],
): SelectOption[] {
    return notes.map(n => {
        const slash = n.path.lastIndexOf('/')
        const folder = slash > 0 ? n.path.slice(0, slash) : undefined
        const o: SelectOption = {
            value: n.path,
            label: n.label ?? baseOf(n.path.replace(/\.md$/, '')),
        }
        if (folder) o.detail = folder
        return o
    })
}
