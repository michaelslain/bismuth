import { parseBaseFile, FRONTMATTER_RE } from './parse'
import { serializeRows } from './rows'
import { placeholderFile } from './types'
import type { Row } from './types'
import type { BaseConfig } from './types'
import { createError } from '../error'

type Meta = { name: string; path: string }

/**
 * Rebuild the file: keep the frontmatter block verbatim, replace the body with the YAML rows.
 * Preserves the column order defined in the base config's first view (or the original data).
 */
export function reassemble(
    text: string,
    rows: Row[],
    config?: BaseConfig,
): string {
    const m = text.match(FRONTMATTER_RE)
    const fm = m ? m[1].replace(/\n*$/, '\n') : ''

    // Extract column order from the base config's first view (if present).
    // Only the view's explicit display `order` is a list of property ids; serializeRows
    // handles `undefined` by falling back to natural row key order. (We must NOT fall back
    // to `groupOrder` — that's a list of GROUP keys for a grouped view, not column ids,
    // and using it as columns would emit empty rows.)
    const columnOrder = config?.views?.[0]?.order

    const body = serializeRows(rows, columnOrder)
    return body ? `${fm}\n${body}\n` : fm
}

/**
 * Insert (index === null) or replace (0 <= index < rows.length) a row in a base file.
 *
 * An out-of-range index THROWS rather than appending, matching `deleteRow`/`reorderRow`.
 * Without the check `rows[index] = row` was silently destructive in both directions:
 * `index = 5` on a 3-row base left holes that `serializeRows` wrote out as literal `- null`
 * rows into the user's file, and `index = -1` set a non-index property, so the edit was
 * discarded while the file was still rewritten. Both are reachable from a STALE client
 * index — two windows on one base, or an SSE refresh racing a delete — so the index is not
 * always the caller's own bug.
 *
 * Appending is deliberately NOT the fallback for an out-of-range index: an index the file
 * cannot satisfy means the caller's view of the row list is stale, and appending would
 * create a row the user never asked for while losing the update they made. `null` stays the
 * one way to say "append", so the two intents can never be confused.
 */
export function upsertRow(
    text: string,
    meta: Meta,
    index: number | null,
    note: Record<string, unknown>,
): string {
    if (!meta.name || !meta.path)
        throw createError('EINVAL', 'meta.name and meta.path are required')
    const { rows, config } = parseBaseFile(text, meta)
    const newRow: Row = {
        file: rows[0]?.file ?? placeholderFile(meta.name, meta.path),
        note,
        formula: {},
    }
    if (index == null) rows.push(newRow)
    else {
        if (!Number.isInteger(index) || index < 0 || index >= rows.length)
            throw createError('EINVAL', `row index out of range: ${index}`)
        rows[index] = newRow
    }
    return reassemble(text, rows, config)
}

/** Remove the row at `index` from a base file. */
export function deleteRow(text: string, meta: Meta, index: number): string {
    const { rows, config } = parseBaseFile(text, meta)
    // `Number.isInteger` first, matching upsertRow and reorderRow: every comparison with NaN
    // is false, so the range check alone let `NaN` through to `splice(NaN, 1)` → `splice(0, 1)`
    // (row 0 deleted), and `2.5` through to `splice(2.5, 1)` (row 2 deleted). Neither is
    // reachable from today's four callers, which all guard at their own boundary — but the
    // next caller inherits whatever this function actually enforces, not what they enforce.
    if (!Number.isInteger(index) || index < 0 || index >= rows.length)
        throw createError('EINVAL', `row index out of range: ${index}`)
    rows.splice(index, 1)
    return reassemble(text, rows, config)
}

/** Move the row at `from` to position `to` (drag-reorder), rewriting the row order. */
export function reorderRow(
    text: string,
    meta: Meta,
    from: number,
    to: number,
): string {
    const { rows, config } = parseBaseFile(text, meta)
    // `Number.isInteger` first: every comparison with NaN is false, so a non-number `from`
    // sailed straight through the two range checks below and `rows.splice(undefined, 1)`
    // coerced to `splice(0, 1)` — moving row 0 whichever row the caller meant. Same shape as
    // the guard on the row update/delete routes.
    if (!Number.isInteger(from) || from < 0 || from >= rows.length)
        throw createError('EINVAL', `row index out of range: ${from}`)
    if (!Number.isInteger(to) || to < 0 || to >= rows.length)
        throw createError('EINVAL', `row index out of range: ${to}`)
    if (from === to) return text
    const [moved] = rows.splice(from, 1)
    rows.splice(to, 0, moved)
    return reassemble(text, rows, config)
}
