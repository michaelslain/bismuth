import { test, expect } from 'bun:test'
import {
    fileLookup,
    fillBacklinks,
    linkTargetOf,
} from '../../src/bases/fileLinks'
import { runView } from '../../src/bases/query'
import { extractEmbeds } from '../../src/embeds'
import { EMPTY_FILE, type BaseConfig, type Row } from '../../src/bases/types'

function row(
    path: string,
    links: string[],
    note: Record<string, unknown> = {},
    embeds: string[] = [],
): Row {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    const folder = path.includes('/')
        ? path.slice(0, path.lastIndexOf('/'))
        : ''
    return {
        file: {
            ...EMPTY_FILE,
            name,
            basename: name,
            path,
            folder,
            links,
            embeds,
        },
        note,
        formula: {},
    }
}

function base(
    formulas: Record<string, string>,
    filters?: BaseConfig['filters'],
): BaseConfig {
    return {
        formulas,
        filters,
        view: { type: 'table', name: 'T' },
    } as BaseConfig
}

const formula = (
    rows: Row[],
    f: Record<string, string>,
    name: string,
    hostThis?: Record<string, unknown>,
) =>
    Object.fromEntries(
        runView(base(f), rows, hostThis).groups[0].rows.map(r => [
            r.file.name,
            r.formula[name],
        ]),
    )

test('extractEmbeds takes targets before | and #, drops a table-escaped \\, skips code', () => {
    const md =
        'a ![[photo.png|200]] b ![[Note#Heading]] ![[cell.jpg\\|50]] [[plain]]\n`![[code.png]]`\n![[photo.png]]'
    expect(extractEmbeds(md)).toEqual(['photo.png', 'Note', 'cell.jpg'])
    expect(extractEmbeds('no embeds [[here]]')).toEqual([])
})

test('linkTargetOf reads link text, links and plain names', () => {
    expect(linkTargetOf('[[folder/Note#h|alias]]')).toBe('folder/Note')
    expect(linkTargetOf({ __link: true, path: 'a/B.md' })).toBe('a/B')
    expect(linkTargetOf('Note')).toBe('Note')
    expect(linkTargetOf(3)).toBe('')
})

test('fillBacklinks counts links and embeds from every row, once per linking note, by path', () => {
    const rows = [
        row('z.md', ['target', 'target']),
        row('a/y.md', [], {}, ['target']),
        row('target.md', []),
        row('lonely.md', ['missing']),
    ]
    fillBacklinks(rows)
    expect(rows[2].file.backlinks).toEqual(['y', 'z'])
    expect(rows[3].file.backlinks).toEqual([])
})

test('a path-qualified link resolves to that note, a bare name to the shallowest', () => {
    const rows = [
        row('Note.md', []),
        row('deep/Note.md', []),
        row('l1.md', ['deep/Note']),
        row('l2.md', ['Note']),
    ]
    fillBacklinks(rows)
    expect(rows[0].file.backlinks).toEqual(['l2'])
    expect(rows[1].file.backlinks).toEqual(['l1'])
})

test('file.backlinks, file.embeds and file.properties in formulas', () => {
    const rows = [
        row('a.md', ['b'], { status: 'open' }, ['pic.jpg']),
        row('b.md', []),
    ]
    fillBacklinks(rows)
    const f = {
        n: 'file.backlinks.length',
        e: 'if(file.embeds[0].containsAny("jpg","gif"), file.embeds[0])',
        p: 'file.properties.status',
    }
    expect(formula(rows, f, 'n')).toEqual({ a: 0, b: 1 })
    expect(formula(rows, f, 'e')).toEqual({ a: 'pic.jpg', b: undefined })
    expect(formula(rows, f, 'p')).toEqual({ a: 'open', b: undefined })
})

test('a row without links data reads empty backlinks and embeds', () => {
    const bare: Row = {
        file: { ...EMPTY_FILE, name: 'x', basename: 'x', path: 'x.md' },
        note: {},
        formula: {},
    }
    expect(
        formula(
            [bare],
            { n: 'file.backlinks.length', e: 'file.embeds.isEmpty()' },
            'n',
        ),
    ).toEqual({ x: 0 })
    expect(formula([bare], { e: 'file.embeds.isEmpty()' }, 'e')).toEqual({
        x: true,
    })
})

test('asFile() on link text, a link, a file; null when nothing matches', () => {
    const rows = [
        row('places/Kyoto.md', [], { type: ['[[Restaurants]]'] }),
        row('cats/Restaurants.md', [], { icon: 'utensils', color: 'red' }),
    ]
    const f = {
        icon: 'list(type)[0].asFile().properties.icon',
        viaLink: 'link("Restaurants").asFile().name',
        self: 'file.asFile().path',
        none: '"[[Nowhere]]".asFile()',
    }
    expect(formula(rows, f, 'icon').Kyoto).toBe('utensils')
    expect(formula(rows, f, 'viaLink').Kyoto).toBe('Restaurants')
    expect(formula(rows, f, 'self').Kyoto).toBe('places/Kyoto.md')
    expect(formula(rows, f, 'none').Kyoto).toBeNull()
})

test('this.file takes the host row, so this.file.links compares with each row', () => {
    const rows = [
        row('host.md', ['a', 'b']),
        row('a.md', ['b']),
        row('b.md', []),
    ]
    fillBacklinks(rows)
    const hostThis = {
        file: {
            ...EMPTY_FILE,
            name: 'host',
            basename: 'host',
            path: 'host.md',
        },
    }
    const f = {
        shared: 'list(this.file.links).filter(list(file.links).containsAny(value)).length',
        back: 'this.file.backlinks.length',
    }
    expect(formula(rows, f, 'shared', hostThis)).toEqual({
        host: 2,
        a: 1,
        b: 0,
    })
    expect(formula(rows, f, 'back', hostThis).a).toBe(0)
})

test('fileLookup finds by path, by name and by link text', () => {
    const rows = [row('x/Note.md', [])]
    const find = fileLookup(rows)
    expect(find('x/Note')?.file.path).toBe('x/Note.md')
    expect(find('x/Note.md')?.file.path).toBe('x/Note.md')
    expect(find('[[Note]]')?.file.path).toBe('x/Note.md')
    expect(find('Other')).toBeUndefined()
})
