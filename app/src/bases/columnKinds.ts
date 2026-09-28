// Pure column-kind predicates + tiny helpers shared by every Bases view. No framework imports.
import type { Row } from '../../../core/src/bases/types'

export function capitalize(s: string): string {
    return s.length ? s[0].toUpperCase() + s.slice(1) : s
}

/** Is this row a task? In tasks mode, every row is, by declaration — that is what the mode
 *  MEANS, and it is the only thing that works for a stored row (which has no source line to
 *  sniff for). In normal mode a row can still be a task line that arrived through a
 *  `source: tasks` query, so the shape check (note.line + note.status + note.raw, as
 *  produced by taskToRow) stays as the fallback. */
export function isTaskRow(
    row: Row,
    mode: 'normal' | 'tasks' = 'normal',
): boolean {
    if (mode === 'tasks') return true
    const n = row.note as Record<string, unknown> | undefined
    return (
        !!n &&
        typeof n.line === 'number' &&
        typeof n.status === 'string' &&
        'raw' in n
    )
}

/** Bare property name (drop file./note./this./formula. namespace), lowercased. */
export function bareName(id: string): string {
    const dot = id.indexOf('.')
    const base = dot >= 0 ? id.slice(dot + 1) : id
    return base.toLowerCase()
}

/** Heuristic: which columns should render as colored-dot status text. */
export function isStatusColumn(id: string): boolean {
    return bareName(id) === 'status'
}
/** Heuristic: which columns are tag lists (rendered as plain teal #tags). */
export function isTagColumn(id: string): boolean {
    const n = bareName(id)
    return n === 'tags' || n === 'tag'
}
/** Heuristic: which columns are numeric ratings (rendered as gold stars). */
export function isRatingColumn(id: string): boolean {
    const n = bareName(id)
    return n === 'rating' || n === 'stars' || n === 'score'
}
/** Heuristic: which column is a page count (rendered as "N pages" on the right). */
export function isPagesColumn(id: string): boolean {
    const n = bareName(id)
    return n === 'pages' || n === 'pagecount' || n === 'page_count'
}

export function findColumn(
    cols: string[],
    pred: (id: string) => boolean,
): string | undefined {
    return cols.find(pred)
}

export function asNumber(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v)
    return undefined
}
