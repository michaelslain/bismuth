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
import { AUTO_CATEGORY_TOKENS, resolveCategoryColor } from './categoryColor'

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

/** The AUTO_CATEGORY_TOKENS entry a name hashes to, advanced to the next unused token (in
 *  token order, wrapping) when `used` already claims the hashed one. Keeping the hash as the
 *  STARTING point (rather than picking arbitrarily) is what keeps a name's colour stable when
 *  the set of other categories around it is unchanged — only a genuine collision moves it.
 *  When every token is already taken (more categories than tokens), there is no distinct
 *  token left to give, so this falls back to the plain hashed one and a duplicate is
 *  unavoidable. */
function autoCategoryToken(name: string, used: ReadonlySet<string>): string {
    const tokens = AUTO_CATEGORY_TOKENS
    const start = hashString(name) % tokens.length
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[(start + i) % tokens.length]
        if (!used.has(token)) return token
    }
    return tokens[start]
}

/** A deterministic palette token for a name that has no declared colour — a stable hash of the
 *  name into AUTO_CATEGORY_TOKENS, so the same source note is the same colour on every open and
 *  in every pane, with no state anywhere. Considered alone (no sibling categories), so this is
 *  the plain hash with nothing to collide against — see `taskCategoryColors` for the
 *  collision-probed version used across a real category set. */
export function autoCategoryColor(name: string): string {
    return resolveCategoryColor(autoCategoryToken(name, new Set()))
}

/** name → resolved CSS colour (via resolveCategoryColor), declared colours winning over auto.
 *  Names absent from `declared` still get a colour — that is the point.
 *
 *  Auto-assigned names are walked in `names`' first-seen order and PROBED against every token
 *  already handed out in this same call: a hash collision advances to the next unused token
 *  instead of silently reusing one, so up to `AUTO_CATEGORY_TOKENS.length` distinct auto names
 *  always get distinct colours. A name's colour can therefore shift when an earlier-seen
 *  category is added or removed — chosen deliberately over a pure hash's perfect stability,
 *  because a visible duplicate swatch is the defect a person actually sees; drift is not. */
export function taskCategoryColors(
    names: string[],
    declared: TaskCategory[] | undefined,
): Map<string, string> {
    const declaredByName = new Map(
        (declared ?? []).map(c => [c.name, c.color] as const),
    )
    const colors = new Map<string, string>()
    const usedTokens = new Set<string>()
    for (const name of names) {
        const declaredColor = declaredByName.get(name)
        if (declaredColor !== undefined) {
            colors.set(name, resolveCategoryColor(declaredColor))
            continue
        }
        const token = autoCategoryToken(name, usedTokens)
        usedTokens.add(token)
        colors.set(name, resolveCategoryColor(token))
    }
    return colors
}
