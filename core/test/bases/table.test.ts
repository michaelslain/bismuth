import { test, expect } from 'bun:test'
import { parseMarkdownTable } from '../../src/bases/table'

test('parseMarkdownTable reads headers and rows into Row.note', () => {
    const md = [
        '| title | date | done |',
        '| --- | --- | --- |',
        '| Dentist | 2026-06-03 | true |',
        '| Lunch | 2026-06-05 | false |',
    ].join('\n')
    const rows = parseMarkdownTable(md, {
        name: 'Calendar',
        path: 'Calendar.md',
    })
    expect(rows.length).toBe(2)
    expect(rows[0].note.title).toBe('Dentist')
    expect(rows[0].note.date).toBe('2026-06-03')
    expect(rows[0].note.done).toBe(true) // "true"/"false" coerced to boolean
    expect(rows[0].file.name).toBe('') // base rows aren't distinct notes
    expect(rows[0].file.path).toBe('Calendar.md')
})

test('parseMarkdownTable returns [] when no table present', () => {
    expect(
        parseMarkdownTable('just prose, no table', { name: 'N', path: 'N.md' }),
    ).toEqual([])
})

test("a cell with both ' P ' text and an escaped pipe keeps both literally", () => {
    const rows = parseMarkdownTable(
        ['| a |', '| --- |', '| has P and \\| pipe |'].join('\n'),
        { name: 'T', path: 'T.md' },
    )
    expect(rows[0].note.a).toBe('has P and | pipe')
})

test('coerces leading-decimal numbers like .5', () => {
    const rows = parseMarkdownTable(['| n |', '| --- |', '| .5 |'].join('\n'), {
        name: 'T',
        path: 'T.md',
    })
    expect(rows[0].note.n).toBe(0.5)
})

test('parseMarkdownTable skips a table after leading prose and stops at blank line', () => {
    const md = [
        'Some intro text.',
        '',
        '| x |',
        '| --- |',
        '| 1 |',
        '',
        'trailing prose | with a pipe',
    ].join('\n')
    const rows = parseMarkdownTable(md, { name: 'N', path: 'N.md' })
    expect(rows.length).toBe(1)
    expect(rows[0].note.x).toBe(1)
})
