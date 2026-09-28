// Pure operator vocabulary for a no-code filter condition row: which operators a property of a
// given coarse type offers, which operators take no value, the date presets, and the file.*
// pseudo-properties the engine filters on even when no frontmatter declares them.
//
// The same tables QueryBuilder.tsx carries inline (OPS_BY_TYPE / FILE_PSEUDO / inferType /
// VALUELESS / DATE_PRESETS). They live here, framework-free, so BaseSettings' FiltersEditor can
// share them; QueryBuilder.tsx still holds its own private copy and should switch to importing
// this module (reported as a follow-up — that file is outside this change).
//
// Compilation of a row to an expression leaf is NOT here: that is queryGen.ts's
// `compileNotesRow`, reused as-is so both builders emit the same leaf for the same row.
import type { Row } from '../../../core/src/bases/types'
import type { NotesOp, PropType } from './queryGen'

export type OpDef = { value: NotesOp; label: string }

const OPS_COMMON_TAIL: OpDef[] = [
    { value: 'is_set', label: 'is set' },
    { value: 'is_empty', label: 'is empty' },
]

export const OPS_BY_TYPE: Record<PropType, OpDef[]> = {
    string: [
        { value: 'equals', label: 'equals' },
        { value: 'not_equals', label: 'does not equal' },
        { value: 'contains', label: 'contains' },
        { value: 'starts_with', label: 'starts with' },
        { value: 'ends_with', label: 'ends with' },
        { value: 'matches', label: 'matches regex' },
        ...OPS_COMMON_TAIL,
    ],
    number: [
        { value: 'equals', label: '=' },
        { value: 'not_equals', label: '≠' },
        { value: 'gt', label: '>' },
        { value: 'gte', label: '≥' },
        { value: 'lt', label: '<' },
        { value: 'lte', label: '≤' },
        ...OPS_COMMON_TAIL,
    ],
    date: [
        { value: 'date_before', label: 'is before' },
        { value: 'date_after', label: 'is on or after' },
        { value: 'date_within', label: 'is within N days' },
        { value: 'is_empty', label: 'is empty' },
    ],
    boolean: [
        { value: 'checked', label: 'is checked' },
        { value: 'unchecked', label: 'is unchecked' },
    ],
    tag: [
        { value: 'has_tag', label: 'has tag' },
        { value: 'not_tag', label: 'does not have tag' },
    ],
    list: [{ value: 'contains', label: 'contains' }, ...OPS_COMMON_TAIL],
    link: [
        { value: 'equals', label: 'links to' },
        { value: 'is_set', label: 'is set' },
    ],
}

/** Every operator's label, for an op a row carries that its type's table does not list
 *  (a reversed leaf can pair e.g. `in_folder` with a plain string type). */
const OP_LABELS: Record<NotesOp, string> = {
    equals: 'equals',
    not_equals: 'does not equal',
    gt: '>',
    gte: '≥',
    lt: '<',
    lte: '≤',
    contains: 'contains',
    starts_with: 'starts with',
    ends_with: 'ends with',
    matches: 'matches regex',
    has_tag: 'has tag',
    not_tag: 'does not have tag',
    in_folder: 'is in folder',
    folder_is: 'folder is',
    date_before: 'is before',
    date_after: 'is on or after',
    date_within: 'is within N days',
    checked: 'is checked',
    unchecked: 'is unchecked',
    is_set: 'is set',
    is_empty: 'is empty',
    raw: 'expression',
}

/** The operator options for a row: its type's table, plus the row's current op when the table
 *  lacks it — so a reversed row never renders a Select whose value matches no option. */
export function opsFor(type: PropType, current?: NotesOp): OpDef[] {
    const base = OPS_BY_TYPE[type] ?? OPS_BY_TYPE.string
    if (!current || base.some(o => o.value === current)) return base
    return [...base, { value: current, label: OP_LABELS[current] }]
}

/** Operators whose value is implied (no value editor). */
export const VALUELESS: ReadonlySet<NotesOp> = new Set<NotesOp>([
    'checked',
    'unchecked',
    'is_set',
    'is_empty',
])

/** Value presets for date_before / date_after (queryGen's `dateRhs` reads these spellings). */
export const DATE_PRESETS: { value: string; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: 'today+7d', label: 'In 7 days' },
    { value: 'today-7d', label: '7 days ago' },
    { value: 'today+1d', label: 'Tomorrow' },
    { value: 'today-1d', label: 'Yesterday' },
]

/** file.* pseudo-properties the engine filters on even when no note frontmatter declares them. */
export const FILE_PSEUDO: { id: string; type: PropType }[] = [
    { id: 'tags', type: 'tag' },
    { id: 'file.folder', type: 'string' },
    { id: 'file.ext', type: 'string' },
    { id: 'file.path', type: 'string' },
    { id: 'file.ctime', type: 'date' },
    { id: 'file.mtime', type: 'date' },
]

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]|$)/

/** Infer a coarse PropType from the first non-null sample of `prop` across the rows. */
export function inferType(prop: string, rows: Row[]): PropType {
    for (const p of FILE_PSEUDO) if (p.id === prop) return p.type
    if (prop === 'file.name') return 'string'
    const key = prop.startsWith('note.') ? prop.slice(5) : prop
    for (const r of rows) {
        const v = r.note[key]
        if (v == null) continue
        if (typeof v === 'number') return 'number'
        if (typeof v === 'boolean') return 'boolean'
        if (Array.isArray(v)) return key === 'tags' ? 'tag' : 'list'
        if (typeof v === 'string')
            return ISO_DATE.test(v.trim()) ? 'date' : 'string'
    }
    return 'string'
}

/** The first operator a freshly-picked property of `type` should start on. */
export function defaultOpFor(type: PropType): NotesOp {
    return OPS_BY_TYPE[type]?.[0]?.value ?? 'equals'
}

/** Distinct folder values across the rows (the in_folder / folder_is value picker). */
export function folderValues(rows: Row[]): string[] {
    const set = new Set<string>()
    for (const r of rows) if (r.file?.folder) set.add(r.file.folder)
    return [...set].sort()
}

/** Distinct tag values across the rows (the has_tag / not_tag value picker). */
export function tagValues(rows: Row[]): string[] {
    const set = new Set<string>()
    for (const r of rows) {
        const t = r.note.tags ?? r.file?.tags
        if (Array.isArray(t))
            for (const x of t)
                if (typeof x === 'string') set.add(x.replace(/^#/, ''))
    }
    return [...set].sort()
}

/** Which value editor an operator calls for. */
export type ValueEditorKind = 'none' | 'tag' | 'folder' | 'date' | 'text'

export function editorKind(op: NotesOp, _type: PropType): ValueEditorKind {
    if (VALUELESS.has(op)) return 'none'
    if (op === 'has_tag' || op === 'not_tag') return 'tag'
    if (op === 'in_folder' || op === 'folder_is') return 'folder'
    if (op === 'date_before' || op === 'date_after') return 'date'
    return 'text'
}
