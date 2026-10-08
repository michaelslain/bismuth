import { describe, expect, test } from 'bun:test'
import {
    BASE_EXT,
    baseFormatOf,
    baseNameOf,
    convertMdBaseToJsonl,
    isBasePath,
    isBaseText,
    mutateBaseConfig,
    parseBaseJsonl,
    readBaseConfigRaw,
    reassembleBaseJsonl,
    serializeBaseJsonl,
} from '../../src/bases/baseFile'
import { parseBaseFile } from '../../src/bases/parse'
import { deleteRow, reorderRow, upsertRow } from '../../src/bases/rowOps'

const META = { name: 'T', path: 'T.base.jsonl' }

const MD_YAML = [
    '---',
    'type: base',
    'view: kanban',
    'groupBy: { property: status }',
    'order: [title, status]',
    'filters: { and: [] }',
    '---',
    '',
    '- id: 1',
    '  title: A',
    '  status: todo',
    '- id: 2',
    '  title: B',
    '  status: done',
].join('\n')

const MD_TABLE = [
    '---',
    'type: base',
    'view: table',
    '---',
    '',
    '| id | title |',
    '| --- | --- |',
    '| 1 | A |',
    '| 2 | B |',
].join('\n')

describe('paths + sniffing', () => {
    test('extension helpers', () => {
        expect(BASE_EXT).toBe('.base.jsonl')
        expect(isBasePath('a/Cal.base.jsonl')).toBe(true)
        expect(isBasePath('a/Cal.md')).toBe(false)
        expect(baseNameOf('a/Cal.base.jsonl')).toBe('Cal')
        expect(baseNameOf('a/Cal.md')).toBe('Cal')
    })
    test('format is sniffed from the first non-whitespace char', () => {
        expect(baseFormatOf('{"type":"base"}\n')).toBe('jsonl')
        expect(baseFormatOf('\n  {"type":"base"}')).toBe('jsonl')
        expect(baseFormatOf('---\ntype: base\n---\n')).toBe('md')
        expect(baseFormatOf('')).toBe('md')
    })
    test('readBaseConfigRaw + isBaseText read both formats', () => {
        expect(readBaseConfigRaw('{"type":"base","view":"table"}\n')).toEqual({
            type: 'base',
            view: 'table',
        })
        expect(readBaseConfigRaw(MD_YAML)?.view).toBe('kanban')
        expect(isBaseText(MD_YAML)).toBe(true)
        expect(isBaseText('{"type":"base"}\n{"a":1}\n')).toBe(true)
        expect(isBaseText('{"type":"note"}\n')).toBe(false)
        expect(readBaseConfigRaw('{nope')).toBeNull()
        expect(readBaseConfigRaw('# just a note')).toBeNull()
    })
})

describe('md -> jsonl conversion', () => {
    for (const [label, md] of [
        ['yaml-list body', MD_YAML],
        ['gfm-table body', MD_TABLE],
    ] as const) {
        test(`${label}: config and row notes are deep-equal`, () => {
            const jsonl = convertMdBaseToJsonl(md)
            expect(baseFormatOf(jsonl)).toBe('jsonl')
            expect(jsonl.endsWith('\n')).toBe(true)
            const a = parseBaseFile(md, { name: 'T', path: 'T.md' })
            const b = parseBaseFile(jsonl, META)
            expect(b.config).toEqual(a.config)
            expect(b.rows.map(r => r.note)).toEqual(a.rows.map(r => r.note))
        })
    }
})

describe('jsonl parse', () => {
    test('a garbage line is skipped and counted, others intact', () => {
        const text = '{"type":"base"}\n{"a":1}\nnot json\n\n[1,2]\n{"a":3}\n'
        const { rows, skipped } = parseBaseJsonl(text, META)
        expect(skipped).toBe(2)
        expect(rows.map(r => r.note)).toEqual([{ a: 1 }, { a: 3 }])
        expect(rows.map(r => r.index)).toEqual([0, 1])
    })
    test('serializeBaseJsonl orders columns then stored order, drops undefined', () => {
        const out = serializeBaseJsonl(
            { type: 'base' },
            [{ z: 1, b: 2, a: undefined, c: 3 }],
            ['c'],
        )
        expect(out).toBe('{"type":"base"}\n{"c":3,"z":1,"b":2}\n')
    })
})

describe('jsonl row ops', () => {
    const base = [
        '{"type":"base","view":"table","order":["title","id"]}',
        '{"id":1,"title":"A","extra":"x"}',
        '{"extra":"y","title":"B","id":2}',
        '{"id":3,"title":"C"}',
        '',
    ].join('\n')
    const lines = (t: string) => t.split('\n')

    test('upsertRow keeps every other line byte-identical', () => {
        const out = upsertRow(base, META, 1, { id: 2, title: 'B2' })
        expect(baseFormatOf(out)).toBe('jsonl')
        const a = lines(base)
        const b = lines(out)
        expect(b[0]).toBe(a[0])
        expect(b[1]).toBe(a[1])
        expect(b[3]).toBe(a[3])
        expect(b[2]).toBe('{"title":"B2","id":2}')
    })
    test('editing a row to equal its neighbour keeps each row its own bytes', () => {
        const out = upsertRow(base, META, 0, { id: 2, title: 'B', extra: 'y' })
        const a = lines(base)
        const b = lines(out)
        expect(b[0]).toBe(a[0])
        expect(b[1]).toBe('{"title":"B","id":2,"extra":"y"}')
        expect(b[2]).toBe(a[2])
        expect(b[3]).toBe(a[3])
    })
    test('append keeps existing lines', () => {
        const out = upsertRow(base, META, null, { id: 4, title: 'D' })
        expect(lines(out).slice(0, 4)).toEqual(lines(base).slice(0, 4))
        expect(lines(out)[4]).toBe('{"title":"D","id":4}')
    })
    test('deleteRow + reorderRow return JSONL with other lines untouched', () => {
        const del = deleteRow(base, META, 0)
        expect(lines(del)).toEqual([
            lines(base)[0],
            lines(base)[2],
            lines(base)[3],
            '',
        ])
        const re = reorderRow(base, META, 0, 2)
        expect(lines(re)).toEqual([
            lines(base)[0],
            lines(base)[2],
            lines(base)[3],
            lines(base)[1],
            '',
        ])
    })
    test('mutateBaseConfig changes only line 1', () => {
        const out = mutateBaseConfig(base, raw => {
            raw.view = 'kanban'
            delete raw.order
        })
        expect(lines(out)[0]).toBe('{"type":"base","view":"kanban"}')
        expect(lines(out).slice(1)).toEqual(lines(base).slice(1))
    })
    test('mutateBaseConfig on markdown edits the frontmatter, body verbatim', () => {
        const out = mutateBaseConfig(MD_YAML, raw => {
            raw.view = 'table'
        })
        expect(out).toContain('view: table')
        expect(out).toContain('groupBy: {property: status}')
        expect(out.endsWith(MD_YAML.slice(MD_YAML.indexOf('- id: 1')))).toBe(
            true,
        )
    })
})

describe('unparseable input is preserved or refused', () => {
    test('upsertRow keeps an unparseable line', () => {
        const src = '{"type":"base"}\nnot json\n{"a":1}\n'
        const out = upsertRow(src, META, 0, { a: 9 })
        expect(out).toContain('not json')
        expect(parseBaseJsonl(out, META).skipped).toBe(1)
    })

    test('mutateBaseConfig throws on an unparseable jsonl config line', () => {
        const src = '{"type":"base",}\n{"a":1}\n'
        expect(() =>
            mutateBaseConfig(src, r => void (r.view = 'table')),
        ).toThrow('not a JSON object')
        expect(src).toBe('{"type":"base",}\n{"a":1}\n')
    })

    test('mutateBaseConfig throws AppError on malformed frontmatter', () => {
        const src = '---\ntype: base\nview: [table\n---\n- a: 1\n'
        expect(() =>
            mutateBaseConfig(src, r => void (r.view = 'table')),
        ).toThrow('does not parse')
    })

    test('mutateBaseConfig on missing frontmatter does not TypeError', () => {
        const out = mutateBaseConfig('- a: 1\n', r => void (r.view = 'table'))
        expect(out).toContain('view: table')
        expect(out).toContain('- a: 1')
    })
})

describe('reassembleBaseJsonl reuse', () => {
    test('inserting a row at index 0 of a 2,000-row base keeps every other line byte-identical', () => {
        const rows = Array.from({ length: 2000 }, (_, i) => ({
            id: i,
            name: `row ${i}`,
        }))
        // spaced JSON so reused bytes differ from a fresh serialization
        const lines = rows.map(r => `{ "name": "${r.name}",  "id": ${r.id} }`)
        const text = ['{"type":"base"}', ...lines].join('\n') + '\n'
        const out = reassembleBaseJsonl(text, [
            { id: -1, name: 'new' },
            ...rows,
        ])
        const outLines = out.trimEnd().split('\n')
        expect(outLines[0]).toBe('{"type":"base"}')
        expect(outLines.length).toBe(2002)
        expect(outLines.slice(2)).toEqual(lines)
    })
})
