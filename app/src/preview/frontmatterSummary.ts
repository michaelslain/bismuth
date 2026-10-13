// app/src/preview/frontmatterSummary.ts
// The one-line preview a folded companion frontmatter strip shows between its `---` fences
// (FoldedFence.tsx): every top-level property with a value, as `key: value`, joined by ` // `.
// Lists flatten to comma-separated items; an empty value (`tags: []`, `title:`) is skipped, so a
// fresh template folds to '' and FoldedFence falls back to its bare `…`. Mid-edit YAML that does
// not parse falls back to the block's own non-empty lines joined by ` // `, so the row never
// blanks while the user is typing.
import { parse } from 'yaml'

const SEP = ' // '

function stripFences(raw: string): string {
    return raw
        .replace(/^﻿?---[ \t]*\r?\n?/, '')
        .replace(/\r?\n?---[ \t]*\r?\n?\s*$/, '')
}

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ')
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>)
            .map(([k, v]) => {
                const f = formatValue(v)
                return f ? `${k}: ${f}` : ''
            })
            .filter(Boolean)
            .join(', ')
    }
    return String(value).replace(/\s+/g, ' ').trim()
}

export function summarizeFrontmatter(raw: string): string {
    const body = stripFences(raw)
    if (!body.trim()) return ''
    let data: unknown
    try {
        data = parse(body)
    } catch {
        return body
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .join(SEP)
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        return formatValue(data)
    }
    return Object.entries(data as Record<string, unknown>)
        .map(([key, value]) => {
            const f = formatValue(value)
            return f ? `${key}: ${f}` : ''
        })
        .filter(Boolean)
        .join(SEP)
}
