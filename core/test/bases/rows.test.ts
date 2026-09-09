import { test, expect } from 'bun:test'
import { parseRows, serializeRows } from '../../src/bases/rows'
import { taskToRow } from '../../src/bases/taskRow'
import { parseTaskLine } from '../../src/tasks'

const META = { name: 'Library', path: 'Library.md' }

test('parseRows reads a YAML list body into Row.note', () => {
    const body = [
        '- title: Capital',
        '  author: Marx',
        '  rating: 4',
        '- title: Normal People',
        '  author: Rooney',
        '  rating: 5',
    ].join('\n')
    const rows = parseRows(body, META)
    expect(rows.length).toBe(2)
    expect(rows[0].note.title).toBe('Capital')
    expect(rows[0].note.rating).toBe(4) // numbers stay numbers
    expect(rows[1].note.author).toBe('Rooney')
    expect(rows[0].file.name).toBe('') // base rows aren't distinct notes
    expect(rows[0].file.path).toBe('Library.md')
})

test('parseRows preserves multi-line cell content', () => {
    const body = ['- front: q', '  back: |-', '    line 1', '    line 2'].join(
        '\n',
    )
    const rows = parseRows(body, META)
    expect(rows[0].note.back).toBe('line 1\nline 2')
})

test('serializeRows round-trips a YAML list', () => {
    const rows = parseRows('- a: 1\n  b: x', META)
    const out = serializeRows(rows)
    const back = parseRows(out, META)
    expect(back[0].note.a).toBe(1)
    expect(back[0].note.b).toBe('x')
})

test('parseRows falls back to a markdown table (back-compat)', () => {
    const body = [
        '| title | rating |',
        '| --- | --- |',
        '| Capital | 4 |',
    ].join('\n')
    const rows = parseRows(body, META)
    expect(rows.length).toBe(1)
    expect(rows[0].note.title).toBe('Capital')
    expect(rows[0].note.rating).toBe(4)
})

test('parseRows returns [] for an empty / prose-only body', () => {
    expect(parseRows('', META)).toEqual([])
    expect(parseRows('just some prose', META)).toEqual([])
})

test('parseRows stamps each row with its position in the file', () => {
    const rows = parseRows('- a: 1\n- a: 2\n- a: 3\n', META)
    expect(rows.map(r => r.index)).toEqual([0, 1, 2])
})

test('serializeRows does not write the index back out', () => {
    const rows = parseRows('- a: 1\n', META)
    expect(serializeRows(rows)).not.toContain('index')
})

test('a note row carries no index', () => {
    const row = taskToRow(parseTaskLine('- [ ] a', 'f.md', 0)!)
    expect(row.index).toBeUndefined()
})
