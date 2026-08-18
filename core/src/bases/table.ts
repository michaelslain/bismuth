import type { Row } from './types'
import { syntheticBaseFile } from './types'

/** Coerce a raw table cell string to a value. Empty → undefined (column absent for that row). */
function coerce(raw: string): unknown {
    const s = raw.trim()
    if (s === '') return undefined
    if (s === 'true') return true
    if (s === 'false') return false
    // integers, decimals, and leading-decimal numbers (.5)
    if (/^-?(\d+(\.\d+)?|\.\d+)$/.test(s)) return Number(s)
    return s
}

// A private-use unicode code point that cannot occur in user-authored table
// text, so the escaped-pipe round-trip never corrupts a literal cell value.
const PIPE_PLACEHOLDER = '\uE000'

/** Split a table row on its unescaped pipes, honoring GFM `\|` escapes and the optional outer pipes. */
function splitRow(line: string): string[] {
    const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
    // protect escaped pipes, split on the rest, then restore as literal pipes
    return trimmed
        .split('\\|')
        .join(PIPE_PLACEHOLDER)
        .split('|')
        .map(c => c.split(PIPE_PLACEHOLDER).join('|').trim())
}

// A GFM table separator row: | --- | :--: | etc.
const SEP_RE = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

/** Locate the header line index of the first GFM table in `lines`, or -1. */
function headerIndex(lines: string[]): number {
    for (let i = 0; i < lines.length; i++) {
        if (
            lines[i].includes('|') &&
            i + 1 < lines.length &&
            SEP_RE.test(lines[i + 1])
        )
            return i
    }
    return -1
}

/** The header column names of the first GFM table in `body` (authoritative column order), or []. */
export function tableColumns(body: string): string[] {
    const lines = body.split('\n')
    const i = headerIndex(lines)
    return i < 0 ? [] : splitRow(lines[i])
}

/** Parse the first GFM table found in `body` into rows. file.name/path come from `meta`. */
export function parseMarkdownTable(
    body: string,
    meta: { name: string; path: string },
): Row[] {
    const lines = body.split('\n')
    const i = headerIndex(lines)
    if (i < 0) return []
    const headers = splitRow(lines[i])
    const rows: Row[] = []
    for (let j = i + 2; j < lines.length; j++) {
        const line = lines[j]
        if (!line.includes('|')) break // table ends at the first non-table line
        const cells = splitRow(line)
        const note: Record<string, unknown> = {}
        headers.forEach((h, k) => {
            const v = coerce(cells[k] ?? '')
            if (v !== undefined) note[h] = v
        })
        rows.push({
            // Base rows are not distinct notes — empty file.name (path kept for write-back).
            file: syntheticBaseFile(meta.path),
            note,
            formula: {},
        })
    }
    return rows
}

/** Format a value as a single table cell: escape pipes, flatten newlines, comma-join arrays. */
function fmt(v: unknown): string {
    if (v === undefined || v === null) return ''
    const s = Array.isArray(v) ? v.join(', ') : String(v)
    return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** Serialize rows back to a GFM table given an explicit column order. */
export function rowsToMarkdownTable(columns: string[], rows: Row[]): string {
    const header = `| ${columns.join(' | ')} |`
    const sep = `| ${columns.map(() => '---').join(' | ')} |`
    const body = rows.map(
        r => `| ${columns.map(c => fmt(r.note[c])).join(' | ')} |`,
    )
    return [header, sep, ...body].join('\n')
}
