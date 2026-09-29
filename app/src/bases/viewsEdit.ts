// app/src/bases/viewsEdit.ts
// Pure editing of a base file's RAW `views:` frontmatter — add/duplicate/remove/rename/
// move/change-kind/toggle-mode — plus the one-time MATERIALIZATION a base written with the
// `view: <kind>` shorthand (or flat top-level field-binding keys, see parse.ts's FIELD_KEYS)
// needs before it can carry more than one view.
//
// Deliberately operates on the RAW frontmatter shape (whatever the `yaml` package hands
// back), never on a parsed `ViewConfig` — a parsed view carries defaults `normalizeView`
// invented (`name: "Untitled view"`, `type: "table"`) and derived fields that must never be
// written back to disk as if the user had typed them. Writing this module's output straight
// back with `setProperty(path, 'views', next)` round-trips exactly what a user would have
// written by hand, no more.
//
// No framework imports (Solid/DOM) here on purpose — every function is a plain data
// transform, testable headlessly, and the async orchestration (reading the file, calling
// api.setProperty/deleteProperty, refetching) lives in BaseView.tsx, which owns the network.
import { parse as parseYaml } from 'yaml'
import { FRONTMATTER_RE } from '../../../core/src/bases/parse'

/** One raw view entry, as written in a base file's `views:` array — unparsed, unnormalized. */
export type RawView = Record<string, unknown>

export interface ViewsEditResult {
    views: RawView[]
    /** Top-level frontmatter keys that materialization pulled INTO `views[0]` and that must
     *  now be deleted from the top level (via `api.deleteProperty`) so the value isn't
     *  duplicated in two places. Empty when the base already had an explicit `views:` array —
     *  nothing to materialize. */
    removedKeys: string[]
    /** Each removed key's old top-level value, so an undo can restore the file's prior shape. */
    removedValues: Record<string, unknown>
}

function capitalize(s: string): string {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

// The exact set of top-level flat keys `parseBaseFile` (core/src/bases/parse.ts) folds into
// `config.views[0]` when reading a base with no explicit `views:` array. Kept in sync with
// that function's `FIELD_KEYS` plus its other flat-key reads (order/columns/groupColors/
// hideLabels/sort/groupBy/columnWidths/cardContent/calendarContent/mode/imageFit/
// imageAspectRatio/aggregate/bin/bidirectional/googleCalendarSync) — see its comments for why
// each exists. Per-view raw entries use the SAME key spellings (`normalizeView` reads
// `o.columns` for group order, not `o.groupOrder`), so materialization copies keys verbatim.
const FLAT_VIEW_KEYS = [
    'frontField',
    'backField',
    'dueField',
    'easeField',
    'intervalField',
    'dateField',
    'startTimeField',
    'endTimeField',
    'recurrenceField',
    'categoryField',
    'googleCalendarId',
    'x',
    'y',
    'image',
    'descriptionField',
    'taskFile',
    'defaultCategory',
    'order',
    'columns',
    'groupColors',
    'hideLabels',
    'sort',
    'groupBy',
    'columnWidths',
    'cardContent',
    'calendarContent',
    'mode',
    'imageFit',
    'imageAspectRatio',
    'aggregate',
    'bin',
    'bidirectional',
    'googleCalendarSync',
] as const

/**
 * Materialize a base's raw frontmatter object into a `views:` array. A base already carrying
 * an explicit `views:` array is returned as-is (`removedKeys: []` — nothing to migrate). A
 * base using the `view: <kind>` shorthand and/or flat top-level field-binding keys gets a
 * single-entry `views:` array whose first (only) entry carries `type` (from `view:`, default
 * `"table"`), `name` (capitalized kind), and every flat key that was actually set — so nothing
 * the user configured moves to a different view. `removedKeys` names every top-level key
 * (`view` plus each folded flat key) that must be deleted once `views:` is written, so the
 * value isn't left duplicated at the top level AND inside `views[0]`.
 */
export function materializeViews(
    raw: Record<string, unknown>,
): ViewsEditResult {
    if (Array.isArray(raw.views)) {
        return { views: raw.views as RawView[], removedKeys: [], removedValues: {} }
    }
    const type = typeof raw.view === 'string' ? raw.view : 'table'
    const view0: RawView = { type, name: capitalize(type) }
    const removedKeys: string[] = []
    const removedValues: Record<string, unknown> = {}
    if (raw.view !== undefined) {
        removedKeys.push('view')
        removedValues.view = raw.view
    }
    for (const k of FLAT_VIEW_KEYS) {
        if (raw[k] !== undefined) {
            view0[k] = raw[k]
            removedKeys.push(k)
            removedValues[k] = raw[k]
        }
    }
    return { views: [view0], removedKeys, removedValues }
}

/** Parse a base file's raw frontmatter text and materialize its views — the one entry point
 *  BaseView calls with a freshly-read file body before applying an edit. Malformed/absent
 *  frontmatter parses as an empty object, matching parse.ts's own tolerance. */
export function readViews(text: string): ViewsEditResult {
    const m = text.match(FRONTMATTER_RE)
    const fmText = m ? m[2] : ''
    let raw: Record<string, unknown> = {}
    if (fmText) {
        try {
            const parsed = parseYaml(fmText)
            if (parsed && typeof parsed === 'object')
                raw = parsed as Record<string, unknown>
        } catch {
            // Malformed YAML — same tolerance as parse.ts's safeYaml: treat as empty.
        }
    }
    return materializeViews(raw)
}

/** A name → count of prior uses, so a fresh/duplicated name that collides gets " 2", " 3", …
 *  appended rather than colliding outright ("Table" + "Table" → "Table", "Table 2"). */
function dedupeName(existing: string[], base: string): string {
    if (!existing.includes(base)) return base
    let n = 2
    while (existing.includes(`${base} ${n}`)) n++
    return `${base} ${n}`
}

/** Append a new view of `type`, named after the capitalized kind, de-duplicated against the
 *  existing view names ("Table 2" when a "Table" already exists). */
export function addView(views: RawView[], type: string): RawView[] {
    const names = views.map(v => String(v.name ?? ''))
    const name = dedupeName(names, capitalize(type))
    return [...views, { type, name }]
}

/** Insert a deep clone of `views[i]` right after it, with a de-duplicated name. A no-op (same
 *  array) for an out-of-range index. */
export function duplicateView(views: RawView[], i: number): RawView[] {
    if (i < 0 || i >= views.length) return views
    const src = views[i]
    const names = views.map(v => String(v.name ?? ''))
    const base = String(src.name ?? capitalize(String(src.type ?? 'table')))
    const clone: RawView = JSON.parse(JSON.stringify(src))
    clone.name = dedupeName(names, base)
    const next = [...views]
    next.splice(i + 1, 0, clone)
    return next
}

/** Remove `views[i]`. Never drops below one view — a no-op when `views.length <= 1`, and a
 *  no-op for an out-of-range index. */
export function removeView(views: RawView[], i: number): RawView[] {
    if (views.length <= 1 || i < 0 || i >= views.length) return views
    const next = [...views]
    next.splice(i, 1)
    return next
}

/** Rename `views[i]`. Blank/whitespace-only names are ignored (the view keeps its prior name)
 *  rather than persisting an empty tab label. */
export function renameView(
    views: RawView[],
    i: number,
    name: string,
): RawView[] {
    const trimmed = name.trim()
    if (!trimmed || i < 0 || i >= views.length) return views
    return views.map((v, idx) => (idx === i ? { ...v, name: trimmed } : v))
}

/** Swap `views[i]` with its neighbor in direction `dir` (-1 = left, 1 = right). A no-op at
 *  either edge or for an out-of-range index. */
export function moveView(views: RawView[], i: number, dir: -1 | 1): RawView[] {
    const j = i + dir
    if (i < 0 || i >= views.length || j < 0 || j >= views.length) return views
    const next = [...views]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
}

/** Change `views[i]`'s kind. Leaves every other field untouched — a kind-specific field left
 *  over from the old kind is simply unread by the new renderer (`normalizeView` already
 *  tolerates fields foreign to a view's type). A no-op for an out-of-range index. */
export function changeViewType(
    views: RawView[],
    i: number,
    type: string,
): RawView[] {
    if (i < 0 || i >= views.length) return views
    return views.map((v, idx) => (idx === i ? { ...v, type } : v))
}

/** The raw view's effective mode, folding in the legacy `calendarContent: tasks` spelling —
 *  a RawView-typed mirror of `viewMode()` (core/src/bases/types.ts), since that function is
 *  typed on the parsed `ViewConfig`, not the raw frontmatter shape this module edits. */
function rawViewMode(v: RawView): 'normal' | 'tasks' {
    if (v.mode === 'tasks' || v.mode === 'normal') return v.mode
    if (v.calendarContent === 'tasks') return 'tasks'
    return 'normal'
}

/** Flip `views[i]`'s mode normal ⇄ tasks, writing an explicit `mode:` and dropping the legacy
 *  `calendarContent:` key so the two spellings never disagree afterward. A no-op for an
 *  out-of-range index. */
export function toggleViewMode(views: RawView[], i: number): RawView[] {
    if (i < 0 || i >= views.length) return views
    return views.map((v, idx) => {
        if (idx !== i) return v
        const next: RawView = { ...v }
        next.mode = rawViewMode(v) === 'tasks' ? 'normal' : 'tasks'
        delete next.calendarContent
        return next
    })
}
