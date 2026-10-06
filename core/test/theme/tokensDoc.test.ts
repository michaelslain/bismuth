import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    DESIGN_TOKENS,
    NOT_TOKENS,
    TOKEN_GROUPS,
    tokenDef,
    UNREGISTERED_ROOT_VARS,
} from '../../src/theme/designTokens'

const doc = readFileSync(
    join(import.meta.dir, '../../../docs/settings/tokens.md'),
    'utf8',
)

/** The per-group tables: everything between "## Tokens by group" and the next `## `. */
const groupSection = (() => {
    const start = doc.indexOf('## Tokens by group')
    const end = doc.indexOf('\n## ', start + 1)
    return doc.slice(start, end)
})()

/** Keys named in the first cell of a table row of a given section. */
const rowKeys = (text: string) =>
    [...text.matchAll(/^\| `([^`]+)` \|/gm)].map(m => m[1])

/** Split a table row on unescaped pipes; `\\|` becomes `|`. */
const cells = (row: string) =>
    row
        .replace(/^\|\s*/, '')
        .replace(/\s*\|\s*$/, '')
        .split(/\s\|\s/)
        .map(c => c.trim().replace(/\\\|/g, '|'))

describe('docs/settings/tokens.md', () => {
    it('matches the registry on kind, default and doc for every row', () => {
        const rows = groupSection.split('\n').filter(l => /^\| `[^`]+` \|/.test(l))
        expect(rows.length).toBe(DESIGN_TOKENS.length)
        for (const row of rows) {
            const [keyCell, kind, def, doc] = cells(row)
            const key = keyCell.replace(/`/g, '')
            const d = tokenDef(key)
            expect(d, `unknown key ${key}`).toBeDefined()
            expect(kind, `${key} kind`).toBe(d!.kind)
            expect(def.replace(/^`|`$/g, ''), `${key} default`).toBe(d!.default)
            expect(doc, `${key} doc`).toBe(d!.doc)
        }
    })

    it('lists every registry key in a group table row', () => {
        const rows = new Set(rowKeys(groupSection))
        for (const d of DESIGN_TOKENS)
            expect(rows.has(d.key), `missing row for ${d.key}`).toBe(true)
    })

    it('names no key the registry does not know', () => {
        const known = new Set(DESIGN_TOKENS.map(d => d.key))
        for (const k of rowKeys(groupSection))
            expect(known.has(k), `unknown key in a table row: ${k}`).toBe(true)
    })

    it('has a table for every group, with the right rows in it', () => {
        for (const g of TOKEN_GROUPS) {
            const at = groupSection.indexOf(`\n### ${g}\n`)
            expect(at, `no heading for group ${g}`).toBeGreaterThan(-1)
            const next = groupSection.indexOf('\n### ', at + 1)
            const body = groupSection.slice(at, next === -1 ? undefined : next)
            const want = DESIGN_TOKENS.filter(d => d.group === g).map(d => d.key)
            expect(rowKeys(body)).toEqual(want)
        }
    })

    it('lists every NOT_TOKENS group and every unregistered :root var', () => {
        for (const n of NOT_TOKENS) expect(doc).toContain(n.group)
        for (const k of Object.keys(UNREGISTERED_ROOT_VARS))
            expect(doc).toContain(`\`${k}\``)
    })

    it('documents the legacy aliases', () => {
        for (const d of DESIGN_TOKENS)
            if (d.setting) expect(doc).toContain(`\`${d.setting}\``)
    })
})
