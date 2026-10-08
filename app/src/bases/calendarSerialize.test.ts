import { test, expect } from 'bun:test'
import {
    parseCalendarFile,
    serializeCalendarFile,
    categoriesOf,
} from './calendarSerialize'

const FILE = [
    '---',
    'type: base',
    'view: calendar',
    'schema: { title: text, date: date }',
    'categories:',
    '  - name: Work',
    '    color: "#b00020"',
    '---',
    '',
    '| id | title | date | startTime | endTime | location | link | description | category | recurrence |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    '| a1 | Standup | 2026-05-30 | 09:00 |  |  |  |  | Work |  |',
].join('\n')

test('parse reads frontmatter (incl. schema + categories) and events', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    expect(frontmatter.type).toBe('base')
    expect(frontmatter.schema).toEqual({ title: 'text', date: 'date' })
    expect(categoriesOf(frontmatter)).toEqual([
        { name: 'Work', color: '#b00020' },
    ])
    expect(events.length).toBe(1)
    expect(events[0].title).toBe('Standup')
    expect(events[0].startTime).toBe('09:00')
    expect(events[0].category).toBe('Work')
})

test('serialize preserves schema (not clobbered) and writes categories as a YAML list', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    const out = serializeCalendarFile(frontmatter, events)
    expect(out).toContain('schema:') // <-- the latent data-loss bug this fixes
    expect(out).toContain('- name: Work')
    expect(out).not.toContain('[{"name"') // not JSON-in-YAML anymore
    // round-trips
    const round = parseCalendarFile(out)
    expect(round.frontmatter.schema).toEqual({ title: 'text', date: 'date' })
    expect(round.events[0].title).toBe('Standup')
    expect(categoriesOf(round.frontmatter)).toEqual([
        { name: 'Work', color: '#b00020' },
    ])
})

test('editing categories keeps every other frontmatter key', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    frontmatter.categories = [
        { name: 'Work', color: '#000000' },
        { name: 'Personal', color: '#5b7cfa' },
    ]
    const out = serializeCalendarFile(frontmatter, events)
    expect(out).toContain('- name: Personal')
    expect(out).toContain('schema:')
    expect(out).toContain('view: calendar')
    expect(categoriesOf(parseCalendarFile(out).frontmatter).length).toBe(2)
})

test('recurrence round-trips through a JSON cell', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    events[0].recurrence = {
        type: 'weekly',
        daysOfWeek: [1],
        startDate: '2026-05-30',
        seriesId: 's1',
    }
    const round = parseCalendarFile(serializeCalendarFile(frontmatter, events))
    expect(round.events[0].recurrence?.type).toBe('weekly')
    expect(round.events[0].recurrence?.daysOfWeek).toEqual([1])
})

test('multiple categories round-trip through a JSON array cell', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    events[0].categories = ['Work', 'Personal', 'Urgent']
    const round = parseCalendarFile(serializeCalendarFile(frontmatter, events))
    expect(round.events[0].categories).toEqual(['Work', 'Personal', 'Urgent'])
})

test('a single-category event does not gain a categories array on round-trip', () => {
    const { frontmatter, events } = parseCalendarFile(FILE)
    // FILE's event has only `category: Work` and no categories array.
    const round = parseCalendarFile(serializeCalendarFile(frontmatter, events))
    expect(round.events[0].category).toBe('Work')
    expect(round.events[0].categories).toBeUndefined()
})

test('format round-trips: jsonl stays jsonl, md stays md', () => {
    const md = parseCalendarFile(FILE)
    expect(md.format).toBe('md')
    const jl = serializeCalendarFile(md.frontmatter, md.events, 'jsonl')
    expect(jl.startsWith('{')).toBe(true)
    const back = parseCalendarFile(jl)
    expect(back.format).toBe('jsonl')
    expect(back.events[0].title).toBe('Standup')
    expect(back.frontmatter.schema).toEqual({ title: 'text', date: 'date' })
})

test('a jsonl calendar with an unparseable line throws PARSE_ERROR', () => {
    const jl = serializeCalendarFile({ type: 'base' }, [], 'jsonl') + 'junk\n'
    expect(() => parseCalendarFile(jl)).toThrow(/unparseable/)
})

test('unknown row fields survive an edit of that event and of another', () => {
    const text =
        [
            '{"type":"base","view":"calendar"}',
            '{"id":"a","title":"A","date":"2026-05-30","color":"red","x-custom":{"k":1}}',
            '{"id":"b","title":"B","date":"2026-05-31","color":"blue"}',
        ].join('\n') + '\n'
    const { frontmatter, events } = parseCalendarFile(text)
    const edited = events.map(e => ({ ...e, title: e.title + '2' }))
    const out = serializeCalendarFile(frontmatter, edited, 'jsonl', text)
    const rows = out
        .trim()
        .split('\n')
        .slice(1)
        .map(l => JSON.parse(l))
    expect(rows[0]).toMatchObject({
        title: 'A2',
        color: 'red',
        'x-custom': { k: 1 },
    })
    expect(rows[1]).toMatchObject({ title: 'B2', color: 'blue' })
    const onlyA = serializeCalendarFile(
        frontmatter,
        [{ ...events[0], title: 'A3' }, events[1]],
        'jsonl',
        text,
    )
    expect(JSON.parse(onlyA.split('\n')[2]).color).toBe('blue')
    expect(JSON.parse(onlyA.split('\n')[1]).color).toBe('red')
})

test('editing one event of a JSONL calendar changes exactly its line', () => {
    const lines = [
        '{"view":"calendar","type":"base"}',
        '{"title":"A","date":"2026-05-30","id":"a","categories":["w"],"color":"red"}',
        '{"id":"b","date":"2026-05-31","title":"B","recurrence":{"freq":"weekly"}}',
        '{"id":"c","title":"C","date":"2026-06-01"}',
    ]
    const text = lines.join('\n') + '\n'
    const { frontmatter, events } = parseCalendarFile(text)
    const next = events.map(e => (e.id === 'b' ? { ...e, title: 'B!' } : e))
    const out = serializeCalendarFile(frontmatter, next, 'jsonl', text).split(
        '\n',
    )
    expect(out[0]).toBe(lines[0])
    expect(out[1]).toBe(lines[1])
    expect(out[2]).not.toBe(lines[2])
    expect(JSON.parse(out[2]).title).toBe('B!')
    expect(out[3]).toBe(lines[3])
})
