import { expect, test } from 'bun:test'
import { flattenBaseViews } from '../../src/bases/flattenViews'
import { parseBaseFile } from '../../src/bases/parse'
import { parseFrontmatter } from '../../src/frontmatter'
import { AppError } from '../../src/error'

const meta = { name: 'Board', path: 'Board.md' }
const lines = (...l: string[]) => l.join('\n') + '\n'

// The flattened file must read back as EXACTLY the config the legacy file read as — that is
// the whole contract, so every case checks it before anything else.
function flattensFaithfully(md: string) {
    const out = flattenBaseViews(md)
    expect(parseBaseFile(out, meta)).toEqual(parseBaseFile(md, meta))
    return { out, data: parseFrontmatter(out).data }
}

test('hoists a single legacy view to flat keys: type → view, name dropped, views gone', () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'views:',
            '  - type: kanban',
            '    name: Board',
            '    groupBy: status',
            '    columns: [todo, done]',
            '---',
            '| title | status |',
            '| --- | --- |',
            '| a | todo |',
        ),
    )
    expect(data.type).toBe('base')
    expect(data.view).toBe('kanban')
    expect(data.groupBy).toBe('status')
    expect(data.columns).toEqual(['todo', 'done'])
    expect(data.views).toBeUndefined()
    expect(data.name).toBeUndefined()
})

test('keeps the body verbatim', () => {
    const body = '| title |\n| --- |\n| a |\n'
    const out = flattenBaseViews(
        `---\ntype: base\nviews:\n  - type: table\n---\n${body}`,
    )
    expect(out.endsWith(body)).toBe(true)
})

test("ANDs the entry's filters onto the base's", () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'filters: file.hasTag("book")',
            'views:',
            '  - type: table',
            '    filters: status == "open"',
            '---',
        ),
    )
    expect(data.filters).toEqual({
        and: ['file.hasTag("book")', 'status == "open"'],
    })
})

test("an entry's filters with no base filters become the base's", () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'views:',
            '  - type: table',
            '    filters: status == "open"',
            '---',
        ),
    )
    expect(data.filters).toBe('status == "open"')
})

test("the entry's source replaces the base's, carrying its own from/where", () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'source: notes',
            'where: folder == "A"',
            'views:',
            '  - type: table',
            '    source: tasks',
            '    from: "[[Keep]]"',
            '---',
        ),
    )
    expect(data.source).toEqual({ kind: 'tasks', from: '[[Keep]]' })
    expect(data.where).toBeUndefined()
})

test('a flat top-level key already set wins over the entry (it always overrode it)', () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'sort: [{ property: note.a }]',
            'views:',
            '  - type: table',
            '    sort: [{ property: note.b }]',
            '    limit: 5',
            '---',
        ),
    )
    expect(data.sort).toEqual([{ property: 'note.a' }])
    expect(data.limit).toBe(5)
})

test("the entry's kind beats a `view:` shorthand, as it always did", () => {
    const { data } = flattensFaithfully(
        lines(
            '---',
            'type: base',
            'view: table',
            'views:',
            '  - type: calendar',
            '---',
        ),
    )
    expect(data.view).toBe('calendar')
})

test('an empty views list just goes', () => {
    const { data } = flattensFaithfully('---\ntype: base\nviews: []\n---\n')
    expect(data.views).toBeUndefined()
})

test('leaves a flat base, a non-base note and a note with no frontmatter untouched', () => {
    const flat = '---\ntype: base\nview: kanban\ngroupBy: status\n---\n'
    expect(flattenBaseViews(flat)).toBe(flat)
    const note = '---\ntitle: x\nviews: [1, 2]\n---\nbody'
    expect(flattenBaseViews(note)).toBe(note)
    expect(flattenBaseViews('just text')).toBe('just text')
})

test('refuses a list of more than one view instead of dropping any', () => {
    const md = lines(
        '---',
        'type: base',
        'views:',
        '  - type: table',
        '  - type: kanban',
        '---',
    )
    expect(() => flattenBaseViews(md)).toThrow(AppError)
    expect(() => flattenBaseViews(md)).toThrow(/2 views/)
})

test('a legacy list with extra views still READS, first entry only', () => {
    const { config } = parseBaseFile(
        lines(
            '---',
            'type: base',
            'views:',
            '  - type: cards',
            '    limit: 3',
            '  - type: kanban',
            '---',
        ),
        meta,
    )
    expect(config.view.type).toBe('cards')
    expect(config.view.limit).toBe(3)
})

test('every view key reads from the flat spelling, not only the old fold list', () => {
    const { config } = parseBaseFile(
        lines(
            '---',
            'type: base',
            'view: map',
            'limit: 4',
            'lat: latitude',
            'zoom: 6',
            'summaries: { note.price: Sum }',
            'stats: [{ label: n, value: count() }]',
            '---',
        ),
        meta,
    )
    expect(config.view).toMatchObject({
        type: 'map',
        limit: 4,
        lat: 'latitude',
        zoom: 6,
        summaries: { 'note.price': 'Sum' },
        stats: [{ label: 'n', value: 'count()' }],
    })
})
