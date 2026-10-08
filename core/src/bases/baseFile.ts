// The on-disk format of a base file. A base is ONE file in one of two formats, told apart by
// content (not path): JSON Lines (`.base.jsonl`: line 1 is the config object, every later line
// one row object) or markdown (`type: base` frontmatter + a YAML-list or GFM-table body).
// Every text-in/text-out base function dispatches through `baseFormatOf`.
import { parse as parseYaml } from 'yaml'
import type { Row } from './types'
import { syntheticBaseFile } from './types'
import { parseRows } from './rows'
import {
    mutateFrontmatter,
    setFrontmatterKey,
    deleteFrontmatterKey,
} from '../frontmatter'
import { flattenBaseViews } from './flattenViews'
import { createError } from '../error'

export const BASE_EXT = '.base.jsonl'
export type BaseFormat = 'jsonl' | 'md'

/**
 * Single frontmatter-split regex shared by the base parser and the row rewriter (rowOps.ts)
 * so they slice the exact same boundary. Capture groups:
 *   [1] the whole frontmatter block including the `---` delimiters (rowOps keeps this verbatim)
 *   [2] the inner YAML between the delimiters
 *   [3] the body after the closing delimiter
 */
export const FRONTMATTER_RE = /^(---\r?\n([\s\S]*?)\r?\n---\r?\n?)([\s\S]*)$/

type Meta = { name: string; path: string }
type Raw = Record<string, unknown>

export function isBasePath(rel: string): boolean {
    return rel.endsWith(BASE_EXT)
}

export function baseNameOf(rel: string): string {
    const file = rel.slice(rel.lastIndexOf('/') + 1)
    if (file.endsWith(BASE_EXT)) return file.slice(0, -BASE_EXT.length)
    return file.replace(/\.md$/i, '')
}

/** First non-whitespace character `{` means JSON Lines; anything else is markdown. */
export function baseFormatOf(text: string): BaseFormat {
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (
            c === ' ' ||
            c === '\t' ||
            c === '\n' ||
            c === '\r' ||
            c === '\uFEFF'
        )
            continue
        return c === '{' ? 'jsonl' : 'md'
    }
    return 'md'
}

function isPlainObject(v: unknown): v is Raw {
    return !!v && typeof v === 'object' && !Array.isArray(v)
}

function parseObjectLine(line: string): Raw | null {
    try {
        const v = JSON.parse(line)
        return isPlainObject(v) ? v : null
    } catch {
        return null
    }
}

function safeYamlObject(text: string): Raw | null {
    try {
        const d = parseYaml(text)
        return isPlainObject(d) ? d : null
    } catch {
        return null
    }
}

/** Offsets of the config line (line 1) in JSONL text: it starts at the first non-whitespace
 *  character and ends before the newline that follows it. `end === text.length` when the
 *  file has a single line. */
function configLineSpan(text: string): { start: number; end: number } {
    let start = 0
    while (start < text.length && /\s/.test(text[start])) start++
    const nl = text.indexOf('\n', start)
    return { start, end: nl === -1 ? text.length : nl }
}

/** The config object of a base file: JSONL line 1, or the markdown frontmatter data. Null
 *  when neither parses. */
export function readBaseConfigRaw(text: string): Raw | null {
    if (baseFormatOf(text) === 'jsonl') {
        const { start, end } = configLineSpan(text)
        return parseObjectLine(text.slice(start, end).trim())
    }
    const m = text.match(FRONTMATTER_RE)
    return m ? safeYamlObject(m[2]) : null
}

export function isBaseText(text: string): boolean {
    return readBaseConfigRaw(text)?.type === 'base'
}

export function parseBaseJsonl(
    text: string,
    meta: Meta,
): { raw: Raw; rows: Row[]; skipped: number } {
    const { start, end } = configLineSpan(text)
    let skipped = 0
    let raw = parseObjectLine(text.slice(start, end).trim())
    if (!raw) {
        raw = {}
        if (text.slice(start, end).trim() !== '') skipped++
    }
    const rows: Row[] = []
    for (const line of text.slice(end).split('\n')) {
        const t = line.trim()
        if (t === '') continue
        const note = parseObjectLine(t)
        if (!note) {
            skipped++
            continue
        }
        rows.push({
            file: syntheticBaseFile(meta.path),
            note,
            formula: {},
            index: rows.length,
        })
    }
    return { raw, rows, skipped }
}

/** One row as a compact JSON line: keys in `columnOrder` first, then the rest in stored
 *  order; undefined values dropped (JSON.stringify drops them). */
function rowLine(
    note: Record<string, unknown>,
    columnOrder?: string[],
): string {
    if (!columnOrder || columnOrder.length === 0) return JSON.stringify(note)
    const out: Record<string, unknown> = {}
    for (const k of columnOrder) if (note[k] !== undefined) out[k] = note[k]
    for (const k of Object.keys(note))
        if (!(k in out) && note[k] !== undefined) out[k] = note[k]
    return JSON.stringify(out)
}

export function serializeBaseJsonl(
    raw: Raw,
    notes: Record<string, unknown>[],
    columnOrder?: string[],
): string {
    const lines = [
        JSON.stringify(raw),
        ...notes.map(n => rowLine(n, columnOrder)),
    ]
    return lines.join('\n') + '\n'
}

/** Key-order-independent identity of a row, used to find a row's original line again. */
function stableKey(note: Record<string, unknown>): string {
    return JSON.stringify(note, (_k, v) =>
        isPlainObject(v)
            ? Object.fromEntries(
                  Object.entries(v).sort(([a], [b]) =>
                      a < b ? -1 : a > b ? 1 : 0,
                  ),
              )
            : v,
    )
}

/**
 * Rewrite a JSONL base with new rows. Line 1 and every row whose content is unchanged keep
 * their ORIGINAL bytes, so a one-row edit is a one-line diff. Only new or changed rows are
 * serialized fresh (in `columnOrder`). Unparseable lines are kept verbatim after the rows.
 */
export function reassembleBaseJsonl(
    text: string,
    notes: Record<string, unknown>[],
    columnOrder?: string[],
): string {
    const { start, end } = configLineSpan(text)
    const head = text.slice(start, end).replace(/\r$/, '')
    const ordinal: { key: string; line: string; used: boolean }[] = []
    const unparsed: string[] = []
    for (const line of text.slice(end).split('\n')) {
        const t = line.trim()
        if (t === '') continue
        const note = parseObjectLine(t)
        if (!note) {
            unparsed.push(t)
            continue
        }
        const key = stableKey(note)
        ordinal.push({ key, line: t, used: false })
    }
    const lines = [head]
    const keys = notes.map(stableKey)
    const picked: (string | undefined)[] = keys.map((key, i) => {
        const same = ordinal[i]
        if (!same || same.key !== key) return undefined
        same.used = true
        return same.line
    })
    const unused = new Map<string, string[]>()
    for (const o of ordinal) {
        if (o.used) continue
        const list = unused.get(o.key)
        if (list) list.push(o.line)
        else unused.set(o.key, [o.line])
    }
    const cursor = new Map<string, number>()
    keys.forEach((key, i) => {
        if (picked[i] !== undefined) return
        const at = cursor.get(key) ?? 0
        const line = unused.get(key)?.[at]
        if (line === undefined) return
        cursor.set(key, at + 1)
        picked[i] = line
    })
    notes.forEach((note, i) => {
        lines.push(picked[i] ?? rowLine(note, columnOrder))
    })
    lines.push(...unparsed)
    return lines.join('\n') + '\n'
}

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b)
}

/** Edit the base's config. JSONL: rewrites line 1 only, every row line stays byte-identical.
 *  Markdown: edits the frontmatter via `mutateFrontmatter`, keeping comments and key order. */
export function mutateBaseConfig(
    text: string,
    mutate: (raw: Raw) => void,
): string {
    if (baseFormatOf(text) === 'jsonl') {
        const { start, end } = configLineSpan(text)
        const raw = parseObjectLine(text.slice(start, end).trim())
        if (!raw)
            throw createError(
                'PARSE_ERROR',
                'base config (line 1) is not a JSON object; fix it before editing',
            )
        mutate(raw)
        return text.slice(0, start) + JSON.stringify(raw) + text.slice(end)
    }
    const fm = text.match(FRONTMATTER_RE)
    if (fm && fm[2].trim() !== '' && !safeYamlObject(fm[2]))
        throw createError(
            'PARSE_ERROR',
            'base config (frontmatter) does not parse; fix it before editing',
        )
    return mutateFrontmatter(text, (doc, data) => {
        const prev = (data ?? {}) as Raw
        const next = structuredClone(prev)
        mutate(next)
        for (const k of Object.keys(prev)) if (!(k in next)) doc.delete(k)
        for (const k of Object.keys(next))
            if (!sameJson(next[k], prev[k])) doc.set(k, next[k])
        return { keep: Object.keys(next).length > 0, result: '' }
    })
}

/** A markdown base (frontmatter + YAML-list or GFM-table body) as a JSONL base. */
export function convertMdBaseToJsonl(mdText: string): string {
    const m = mdText.match(FRONTMATTER_RE)
    const raw = (m ? safeYamlObject(m[2]) : null) ?? {}
    const body = m ? m[3] : mdText
    const rows = parseRows(body, { name: '', path: '' })
    return serializeBaseJsonl(
        raw,
        rows.map(r => r.note),
    )
}

/** Set one config key: line 1 of a JSON Lines base (rows untouched), else a frontmatter key.
 *  JSONL handling needs BOTH a base path and JSONL content, so a plain note that happens to
 *  start with `{` is still edited as markdown. A markdown base with a `views:` list is
 *  flattened first. */
export function setBaseConfigKey(
    path: string,
    text: string,
    key: string,
    value: unknown,
): string {
    if (isBasePath(path) && baseFormatOf(text) === 'jsonl')
        return mutateBaseConfig(text, raw => {
            raw[key] = value
        })
    return setFrontmatterKey(flattenBaseViews(text), key, value)
}

export function deleteBaseConfigKey(
    path: string,
    text: string,
    key: string,
): string {
    if (isBasePath(path) && baseFormatOf(text) === 'jsonl')
        return mutateBaseConfig(text, raw => {
            delete raw[key]
        })
    return deleteFrontmatterKey(flattenBaseViews(text), key)
}
