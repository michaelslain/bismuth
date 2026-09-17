// A task's SOURCE is its category. Two cases share one axis:
//  - a row SCANNED out of notes (source: tasks / notes / base) has a real markdown line
//    (`note.line` is a number) — its category is the source note's basename (`row.file.name`).
//  - a row a base OWNS (no `source:`, so no `note.line`) has no source note — its category is
//    the value of its category column (`categoryField`, default "category").
// An explicit `categoryField` always wins over both, when it resolves to a real value.
//
// Pure — no framework imports, so this is unit-testable headlessly and importable from any
// surface (the tasks register, a future legend, …) without pulling in Solid.
import type { Row } from '../../../core/src/bases/types'
import { PALETTE_TOKENS } from '../ui/palette'
import { resolveCategoryColor } from './categoryColor'

export type TaskCategory = { name: string; color: string }

function nonEmptyString(v: unknown): string | undefined {
    return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

/** The category NAME a task row belongs to, or undefined.
 *  1. `categoryField` set → `row.note[categoryField]` when it is a non-empty string.
 *  2. else a SCANNED row (typeof row.note.line === 'number') → `row.file.name`.
 *  3. else `row.note.category` when it is a non-empty string.
 *  4. else undefined. */
export function taskCategoryName(
    row: Row,
    categoryField?: string,
): string | undefined {
    if (categoryField) {
        const explicit = nonEmptyString(row.note[categoryField])
        if (explicit !== undefined) return explicit
    }
    if (typeof row.note.line === 'number') return row.file.name
    return nonEmptyString(row.note.category)
}

/** Every distinct category name across `rows`, in first-seen order. */
export function taskCategoryNames(
    rows: Row[],
    categoryField?: string,
): string[] {
    const seen = new Set<string>()
    const names: string[] = []
    for (const row of rows) {
        const name = taskCategoryName(row, categoryField)
        if (name !== undefined && !seen.has(name)) {
            seen.add(name)
            names.push(name)
        }
    }
    return names
}

// A plain string hash (djb2-derived) — deterministic across runs, processes, and reloads, and
// depends on nothing but the characters of `name` itself: no counter, no insertion order, no
// module-level state. The same source note is therefore the same colour in every pane, on every
// reload, with zero configuration.
function hashString(s: string): number {
    let h = 5381
    for (let i = 0; i < s.length; i++) {
        h = (h * 33 + s.charCodeAt(i)) | 0
    }
    return h >>> 0
}

/** A deterministic palette token for a name that has no declared colour — a stable hash of the
 *  name into PALETTE_TOKENS, so the same source note is the same colour on every open and in
 *  every pane, with no state anywhere. */
export function autoCategoryColor(name: string): string {
    const token = PALETTE_TOKENS[hashString(name) % PALETTE_TOKENS.length]
    return resolveCategoryColor(token)
}

/** name → resolved CSS colour (via resolveCategoryColor), declared colours winning over auto.
 *  Names absent from `declared` still get a colour — that is the point. */
export function taskCategoryColors(
    names: string[],
    declared: TaskCategory[] | undefined,
): Map<string, string> {
    const declaredByName = new Map(
        (declared ?? []).map(c => [c.name, c.color] as const),
    )
    const colors = new Map<string, string>()
    for (const name of names) {
        const declaredColor = declaredByName.get(name)
        colors.set(
            name,
            declaredColor
                ? resolveCategoryColor(declaredColor)
                : autoCategoryColor(name),
        )
    }
    return colors
}
