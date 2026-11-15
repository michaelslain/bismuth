import { describe, expect, test } from 'bun:test'
import {
    KNOWN_FUNCTIONS,
    KNOWN_METHODS,
    KNOWN_SUMMARIES,
    convertBases,
} from '../../src/obsidianImport/bases'
import { parseBaseJsonl } from '../../src/bases/baseFile'
import { parseBaseFile } from '../../src/bases/parse'
import { VIEW_TYPES } from '../../src/bases/types'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImportContext } from '../../src/obsidianImport/types'

const ctx: ImportContext = {
    config: {
        present: false,
        plugins: [],
        app: null,
        dailyNotes: null,
        templates: null,
        appearance: null,
        pluginData: {},
    },
    allPaths: [],
}
const run = (files: Record<string, string>, tags: string[] = []) =>
    convertBases(new Map(Object.entries(files)), ctx, tags)
const edit = (r: ReturnType<typeof run>, p: string) =>
    r.edits.find(e => e.path === p)?.text
const config = (r: ReturnType<typeof run>, p: string) =>
    parseBaseJsonl(edit(r, p) as string, { name: '', path: p }).raw

const BOOKS = `filters:
  and:
    - file.hasTag("book")
formulas:
  left: pages - read
properties:
  status:
    displayName: Status
views:
  - type: table
    name: All
    order:
      - file.name
    sort:
      - property: file.name
        direction: ASC
    limit: 20
`

describe('convertBases', () => {
    test('single view becomes a flat .base.jsonl and the .base is deleted', () => {
        const r = run({ 'P/Books.base': BOOKS })
        const c = config(r, 'P/Books.base.jsonl')
        expect(c).toMatchObject({
            source: 'notes',
            filters: { and: ['file.hasTag("book")'] },
            formulas: { left: 'pages - read' },
            properties: { status: { displayName: 'Status' } },
            view: 'table',
            order: ['file.name'],
            limit: 20,
        })
        expect(c.sort).toEqual([{ property: 'file.name', direction: 'ASC' }])
        expect(c.name).toBeUndefined()
        expect(edit(r, 'P/Books.base')).toBeNull()
        const conv = r.items.find(i => i.section === 'converted')!
        expect(conv.detail).toContain('P/Books.base')
        expect(conv.detail).toContain('P/Books.base.jsonl')
    })

    test('a view with its own filters is ANDed with the global ones', () => {
        const r = run({
            'Books.base': `filters: 'file.hasTag("a")'\nviews:\n  - type: list\n    filters: 'x > 1'\n`,
        })
        expect(config(r, 'Books.base.jsonl').filters).toEqual({
            and: ['file.hasTag("a")', 'x > 1'],
        })
    })

    test('three views split into ref bases with one decide item', () => {
        const r = run({
            'P/Books.base': `filters: 'file.hasTag("a")'
views:
  - type: table
    name: One
  - type: cards
    name: Two
  - type: list
    name: Three
`,
        })
        const two = config(r, 'P/Books - Two.base.jsonl')
        expect(two).toMatchObject({
            source: 'base',
            ref: '[[P/Books]]',
            filters: 'file.hasTag("a")',
            view: 'cards',
        })
        expect(config(r, 'P/Books - Three.base.jsonl').view).toBe('list')
        const d = r.items.filter(i => i.section === 'decide')
        expect(d).toHaveLength(1)
        for (const w of ['P/Books - Two.base.jsonl', 'P/Books - Three.base.jsonl', '"One"', '"Two"', '"Three"'])
            expect(d[0].detail).toContain(w)
    })

    test('unsupported summary names are dropped with a lossy item', () => {
        const r = run({
            'B.base': `summaries:\n  mine: values.length\nviews:\n  - type: table\n    summaries:\n      price: Sum\n      pages: Median\n`,
        })
        const c = config(r, 'B.base.jsonl')
        expect(c.summaries).toEqual({ price: 'Sum' })
        const lossy = r.items.filter(i => i.section === 'lossy').map(i => i.detail)
        expect(lossy.some(d => d.includes('Median'))).toBe(true)
        expect(lossy.some(d => d.includes('mine'))).toBe(true)
    })

    test('undefined functions still write the base and add a decide item quoting the expression', () => {
        const r = run({
            'B.base': `filters: 'file.backlinks.length > 2'\nformulas:\n  f: 'file.linksTo(this)'\nviews:\n  - type: table\n`,
        })
        expect(edit(r, 'B.base.jsonl')).toBeTruthy()
        const d = r.items.filter(i => i.section === 'decide').map(i => i.detail)
        expect(d.some(x => x.includes('file.backlinks.length > 2'))).toBe(true)
        expect(d.some(x => x.includes('file.linksTo(this)'))).toBe(true)
    })

    test('supported functions raise no decide item', () => {
        const r = run({
            'B.base': `filters: 'file.hasTag("a") && file.name.lower().contains("x") && date(due) < today()'\nviews:\n  - type: table\n`,
        })
        expect(r.items.filter(i => i.section === 'decide')).toEqual([])
    })

    test('hasTag expands to vault subtags with a lossy item', () => {
        const r = run({ 'B.base': `filters: 'file.hasTag("book")'\nviews:\n  - type: table\n` }, [
            'book',
            'book/fiction',
            'booking',
        ])
        expect(config(r, 'B.base.jsonl').filters).toBe('file.hasTag("book", "book/fiction")')
        expect(r.items.some(i => i.section === 'lossy' && i.detail.includes('book/fiction'))).toBe(true)
    })

    test('merge: Name.md embedding the base becomes a type: base note', () => {
        const r = run({
            'P/Books.base': BOOKS,
            'P/Books.md': '---\naliases: [b]\n---\nSome prose\n\n![[Books.base]]\n',
        })
        const md = edit(r, 'P/Books.md') as string
        expect(md).toContain('aliases:')
        expect(md).toContain('type: base')
        expect(md).toContain('source: notes')
        expect(md).toContain('view: table')
        expect(md).toContain('Some prose')
        expect(md).not.toContain('![[Books.base]]')
        expect(parseBaseFile(md, { name: 'Books', path: 'P/Books.md' }).config.view.type).toBe('table')
        expect(edit(r, 'P/Books.base')).toBeNull()
        expect(edit(r, 'P/Books.base.jsonl')).toBeUndefined()
    })

    test('exists but does not embed: written as Name - View 1 with a defaults item', () => {
        const r = run({ 'P/Books.base': BOOKS, 'P/Books.md': 'just a note\n' })
        expect(edit(r, 'P/Books - All.base.jsonl')).toBeTruthy()
        expect(edit(r, 'P/Books.md')).toBeUndefined()
        expect(r.items.some(i => i.section === 'defaults')).toBe(true)
    })

    test('base fence becomes a query fence; code fences untouched', () => {
        const note = 'a\n\n```base\nfilters: \'file.hasTag("x")\'\nviews:\n  - type: cards\n    limit: 3\n```\n\n````md\n```base\nviews: []\n```\n![[Books.base]] [[Books.base]]\n````\n'
        const out = edit(run({ 'n.md': note }), 'n.md') as string
        expect(out).toContain('```query\n')
        expect(out).toContain('source: notes')
        expect(out).toContain('view: cards')
        expect(out).toContain('limit: 3')
        expect(out).toContain('````md\n```base\nviews: []\n```\n![[Books.base]] [[Books.base]]\n````')
    })

    test('embeds and links to a .base', () => {
        const files = {
            'P/Books.base': `views:
  - type: table
    name: Main
  - type: cards
    name: Shelf
    limit: 5
`,
            'n.md': 'x\n\n![[Books.base]]\n\n![[Books.base#Shelf]]\n\nsee [[Books.base]] and [[P/Books.base|t]] and `[[Books.base]]`\n',
        }
        const out = edit(run(files), 'n.md') as string
        expect(out).toContain('```query\ntype: base\nsource: notes\nview: table\n```')
        expect(out).toContain('view: cards\nlimit: 5\n```')
        expect(out).toContain('see [[Books]] and [[P/Books|t]] and `[[Books.base]]`')
    })

    test('map coordinates is lossy; kanban keeps groupBy', () => {
        const map = run({ 'M.base': `views:\n  - type: map\n    coordinates: note.coords\n` })
        expect(map.items.some(i => i.section === 'lossy' && i.detail.includes('lat'))).toBe(true)
        const k = run({ 'K.base': `views:\n  - type: kanban\n    groupBy:\n      property: note.status\n` })
        expect(config(k, 'K.base.jsonl').groupBy).toEqual({ property: 'note.status' })
    })

    test('every written config is a valid base; unknown layouts fall back to table with a decide item', () => {
        const r = run({
            'A.base': `views:\n  - type: table\n  - type: cards\n  - type: timeline\n`,
        })
        for (const e of r.edits)
            if (e.text && e.path.endsWith('.base.jsonl')) {
                const c = parseBaseJsonl(e.text, { name: '', path: e.path }).raw
                expect(c.type).toBe('base')
                expect((VIEW_TYPES as string[]).includes(c.view as string)).toBe(true)
            }
        expect(config(r, 'A - View 3.base.jsonl').view).toBe('table')
        expect(r.items.some(i => i.section === 'decide' && i.detail.includes('timeline'))).toBe(true)
    })

    test('an existing X.base.jsonl is never overwritten', () => {
        const r = convertBases(
            new Map([['B.base', 'views:\n  - type: table\n']]),
            { ...ctx, allPaths: ['B.base', 'B.base.jsonl'] },
            [],
        )
        expect(r.edits.some(e => e.path === 'B.base.jsonl')).toBe(false)
        expect(r.edits.some(e => e.path === 'B - View 1.base.jsonl' || e.path.startsWith('B - '))).toBe(true)
    })

    test('split views keep formulas and properties', () => {
        const r = run({
            'B.base': `formulas:
  left: pages - read
views:
  - type: table
    name: One
  - type: table
    name: Two
    order:
      - formula.left
`,
        })
        const p = r.edits.find(e => e.path.startsWith('B - Two'))!.path
        expect(config(r, p).formulas).toEqual({ left: 'pages - read' })
    })

    test('a merged embed removes only the embed, keeping prose on its line', () => {
        const r = run({
            'Books.base': 'views:\n  - type: table\n',
            'Books.md': '---\naliases: [b]\n---\nIntro ![[Books.base]] trailing prose\n',
        })
        expect(edit(r, 'Books.md')).toContain('Intro  trailing prose')
    })

    test('merge into a note with no frontmatter keeps the body and becomes a type: base note', () => {
        const r = run({ 'Books.base': BOOKS, 'Books.md': 'Intro ![[Books.base]]\n' })
        const md = edit(r, 'Books.md') as string
        expect(md.startsWith('---\ntype: base\n')).toBe(true)
        expect(md).toContain('Intro')
        expect(md).not.toContain('![[Books.base]]')
        expect(parseBaseFile(md, { name: 'Books', path: 'Books.md' }).config.view.type).toBe('table')
    })

    test('an embed inside a callout keeps the > prefix on every fence line', () => {
        const r = run({ 'Books.base': BOOKS, 'n.md': '> [!note] t\n> ![[Books.base]]\n> after\n' })
        const out = edit(r, 'n.md') as string
        const lines = out.split('\n').filter(l => l)
        expect(lines.every(l => l.startsWith('>'))).toBe(true)
        expect(out).toContain('> ```query')
        expect(out).toContain('> ```\n> after')
    })

    test('an embed inside a list item is left as written with a decide item', () => {
        const r = run({ 'Books.base': BOOKS, 'n.md': '- item ![[Books.base]] tail\n' })
        expect(edit(r, 'n.md')).toBeUndefined()
        expect(r.items.some(i => i.section === 'decide' && i.path === 'n.md' && i.detail.includes('- item ![[Books.base]] tail'))).toBe(true)
    })

    test('a link to a base that did not merge into the same-named note follows the written file', () => {
        const r = run({
            'Books.base': 'views:\n  - type: table\n    name: All\n',
            'Books.md': 'note\n',
            'n.md': 'see [[Books.base]]\n',
        })
        expect(edit(r, 'n.md')).toBe('see [[Books - All]]\n')
    })

    test('the hasTag lossy item is reported once per split base', () => {
        const r = run(
            {
                'B.base': `filters:
  and:
    - file.hasTag("book")
views:
  - type: table
    name: A
  - type: table
    name: B
`,
            },
            ['book', 'book/fiction'],
        )
        expect(r.items.filter(i => i.section === 'lossy' && i.detail.includes('hasTag'))).toHaveLength(1)
    })
})

describe('pinned to Bismuth', () => {
    const src = (f: string) =>
        readFileSync(join(import.meta.dir, '../../src/bases', f), 'utf8')
    const cases = (s: string) =>
        new Set([...s.matchAll(/case '(\w+)'/g)].map(m => m[1]))
    test('known functions and methods equal the evaluator cases', () => {
        const known = new Set([...KNOWN_FUNCTIONS, ...KNOWN_METHODS])
        // `case 'x'` arms, plus the methods every value has (`if (name === 'x')` in callMethod)
        const f = src('functions.ts')
        const defined = new Set([...cases(f), ...[...f.matchAll(/if \(name === '(\w+)'\)/g)].map(m => m[1])])
        expect([...known].sort()).toEqual([...defined].sort())
    })
    test('known summaries equal the summary switch', () => {
        const s = src('query.ts')
        const i = s.indexOf('function summarize')
        expect([...KNOWN_SUMMARIES].sort()).toEqual([...cases(s.slice(i, s.indexOf('\n}\n', i)))].sort())
    })
})
