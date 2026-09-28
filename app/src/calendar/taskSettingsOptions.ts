// The option lists behind TaskCalendarSettings' selects, pure. `destinationOptions` (the shared
// note-picker shape) supplies the labels + folder detail; the values here are the wikilink text a
// task calendar stores in its `taskFile`.
import { linkTargetFor } from '../../../core/src/linkTarget'
import { destinationOptions } from '../bases/selectOptions'
import type { SelectOption } from '../ui/Select'

const NOT_SET: SelectOption = { value: '', label: 'not set' }

/** The date column select: `not set` explains where an unbound task lands. */
export function dateColumnOptions(columns: string[]): SelectOption[] {
    return [
        {
            ...NOT_SET,
            detail: 'falls back to scheduled, then due',
        },
        ...columns.map(c => ({ value: c, label: c })),
    ]
}

export function categoryColumnOptions(columns: string[]): SelectOption[] {
    return [NOT_SET, ...columns.map(c => ({ value: c, label: c }))]
}

/** Vault note paths as destination options: basename label, folder detail, and a value that is
 *  already the wikilink to store — the bare basename when unambiguous, else `linkTargetFor`'s
 *  path-qualified form. */
export function destinationNoteOptions(notes: string[]): SelectOption[] {
    const ids = notes.map(n => n.replace(/\.md$/, ''))
    const shown = destinationOptions(notes.map(path => ({ path })))
    return [
        NOT_SET,
        ...shown.map((o, i) => ({
            ...o,
            value: `[[${linkTargetFor(ids[i], ids)}]]`,
        })),
    ]
}
