// The tasks calendar's pure decisions — which destinations a composed task can land in, what
// note/body a new task writes, which columns the settings modal offers. No framework imports, so
// TasksCalendar.tsx only wires signals and the api around these.
import type { Row } from '../../../core/src/bases/types'
import { fileBasename } from '../../../core/src/pathUtils'
import { refToPath } from '../../../core/src/bases/sourceSpec'
import type { TaskComposeTarget } from '../calendar/taskCompose'

/** `line`/`resolved`/`statusChar`/`placed` are the task parser's own handles, not columns a
 *  person authored — offering them as a Date/Category column choice is nonsense. */
const INTERNAL_KEYS = new Set(['line', 'resolved', 'statusChar', 'placed'])

export function composeColumns(rows: Row[]): string[] {
    const seen = new Set<string>()
    for (const row of rows)
        for (const key of Object.keys(row.note))
            if (!INTERNAL_KEYS.has(key)) seen.add(key)
    return [...seen]
}

/** The view's `taskFile` as a target id. A `[[General Tasks]]` ref names a note by BASENAME, the
 *  way a wikilink does, so match it against the source notes already on the grid first —
 *  `refToPath` alone turns it into a ROOT path (`General Tasks.md`) that never equals the real
 *  `tasks/General Tasks.md`, which listed the same note twice in the picker. */
export function taskFileTargetId(
    rowPaths: string[],
    taskFile: string | undefined,
): string {
    if (!taskFile) return ''
    const path = refToPath(taskFile)
    if (!path || rowPaths.includes(path)) return path
    const base = fileBasename(path)
    return rowPaths.find(p => fileBasename(p) === base) ?? path
}

export type ComposeTargetsInput = {
    rows: Row[]
    ownsRows: boolean
    /** Category names the base declares in its own `categories:`. */
    declared: string[]
    /** Category names already seen on a row. */
    names: string[]
    colors: Map<string, string>
    taskFile: string | undefined
}

/** Every destination a composed task could land in. Sourced (`source: tasks`): one per distinct
 *  source note on the grid (id = vault PATH, label = basename), plus the view's own `taskFile`.
 *  Owns its rows: one per category name in play, and a leading "no category" (`id: ''`). */
export function composeTargets(input: ComposeTargetsInput): TaskComposeTarget[] {
    if (input.ownsRows) {
        const seen = new Set<string>()
        const names: string[] = []
        for (const name of [...input.names, ...input.declared]) {
            if (seen.has(name)) continue
            seen.add(name)
            names.push(name)
        }
        return [
            { id: '', label: 'no category' },
            ...names.map(name => ({
                id: name,
                label: name,
                color: input.colors.get(name),
            })),
        ]
    }
    const byPath = new Map<string, TaskComposeTarget>()
    for (const row of input.rows) {
        if (typeof row.note.line !== 'number') continue
        if (byPath.has(row.file.path)) continue
        byPath.set(row.file.path, {
            id: row.file.path,
            label: row.file.name,
            color: input.colors.get(row.file.name),
        })
    }
    const path = taskFileTargetId([...byPath.keys()], input.taskFile)
    if (path && !byPath.has(path)) {
        const label = fileBasename(path)
        byPath.set(path, { id: path, label, color: input.colors.get(label) })
    }
    return [...byPath.values()]
}

/** The note a new own-rows task stores. The description comes FIRST and is never empty. */
export function newStoredTaskNote(
    text: string,
    date: string,
    categoryField: string,
    category: string,
): Record<string, unknown> {
    return {
        description: text,
        status: 'todo',
        scheduled: date,
        ...(category ? { [categoryField]: category } : {}),
    }
}

/** The checkbox-line body a new sourced task appends. */
export function sourcedTaskBody(text: string, date: string): string {
    return `${text} [scheduled ${date}]`
}

/** The base's whole `categories:` array with `name` set to `color` — every other declared
 *  category preserved, the picked one replaced in place or appended when new. */
export function declaredCategoriesWith<C extends { name: string; color?: string }>(
    declared: C[],
    name: string,
    color: string,
): (C | { name: string; color: string })[] {
    const idx = declared.findIndex(c => c.name === name)
    return idx >= 0
        ? declared.map((c, i) => (i === idx ? { name, color } : c))
        : [...declared, { name, color }]
}
