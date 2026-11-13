import { describe, expect, test } from 'bun:test'
import { dayAction, dayRow, planSetValue, planToggle, rowsOnDay } from './heatmapWrites'

describe('dayAction', () => {
    test('base-owned numeric, no row yet: edit with no current value', () => {
        const a = dayAction({
            origin: 'base',
            isCount: false,
            dateLabel: 'Sat Dec 6',
            rowCount: 0,
            current: undefined,
        })
        expect(a).toEqual({ kind: 'edit', current: undefined })
    })

    test('base-owned numeric, one row: edit with its value', () => {
        const a = dayAction({
            origin: 'base',
            isCount: false,
            dateLabel: 'Sat Dec 6',
            rowCount: 1,
            current: 347,
        })
        expect(a).toEqual({ kind: 'edit', current: 347 })
    })

    test('base-owned numeric, several rows: drill, names the count', () => {
        const a = dayAction({
            origin: 'base',
            isCount: false,
            dateLabel: 'Sat Dec 6',
            rowCount: 3,
            current: undefined,
        })
        expect(a).toEqual({ kind: 'drill', message: '3 entries — edit in the table' })
    })

    test('base-owned count: always toggles, regardless of row count', () => {
        expect(dayAction({ origin: 'base', isCount: true, dateLabel: 'x', rowCount: 0, current: undefined }))
            .toEqual({ kind: 'toggle' })
        expect(dayAction({ origin: 'base', isCount: true, dateLabel: 'x', rowCount: 4, current: undefined }))
            .toEqual({ kind: 'toggle' })
    })

    test('query origin, exactly one note, numeric: edits', () => {
        const a = dayAction({
            origin: 'query',
            isCount: false,
            dateLabel: 'Sat Dec 6',
            rowCount: 1,
            current: 120,
        })
        expect(a).toEqual({ kind: 'edit', current: 120 })
    })

    test('query origin, no note: drill naming the day', () => {
        const a = dayAction({
            origin: 'query',
            isCount: false,
            dateLabel: 'Sep 14',
            rowCount: 0,
            current: undefined,
        })
        expect(a).toEqual({ kind: 'drill', message: 'no note on Sep 14' })
    })

    test('query origin, several notes: drill naming the count', () => {
        const a = dayAction({
            origin: 'query',
            isCount: false,
            dateLabel: 'Sep 14',
            rowCount: 2,
            current: undefined,
        })
        expect(a).toEqual({ kind: 'drill', message: '2 notes — open one to edit' })
    })

    test('query origin, counting notes: always drills even with exactly one', () => {
        const a = dayAction({
            origin: 'query',
            isCount: true,
            dateLabel: 'Sep 14',
            rowCount: 1,
            current: undefined,
        })
        expect(a).toEqual({ kind: 'drill', message: '1 note — open to edit' })
    })
})

describe('planSetValue', () => {
    test('base origin, no row, a value typed: creates a row with x + y', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: undefined,
            entered: 42,
        })
        expect(intent).toEqual({
            kind: 'create',
            note: { date: '2026-09-14', words: 42 },
        })
    })

    test('base origin, no row, empty input: no write', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: undefined,
            entered: undefined,
        })
        expect(intent).toEqual({ kind: 'none' })
    })

    test('base origin, existing row, a value typed: updates merging onto its note', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: { index: 3, path: 'Journal.md', note: { date: '2026-09-14', words: 10, mood: 'ok' } },
            entered: 99,
        })
        expect(intent).toEqual({
            kind: 'update',
            index: 3,
            note: { date: '2026-09-14', words: 99, mood: 'ok' },
        })
    })

    test('base origin, existing row, cleared: deletes the row', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: { index: 3, path: 'Journal.md', note: { date: '2026-09-14', words: 10 } },
            entered: undefined,
        })
        expect(intent).toEqual({ kind: 'delete', index: 3 })
    })

    test('base origin, existing row, entered 0: deletes rather than leaving a phantom zero', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: { index: 3, path: 'Journal.md', note: { words: 10 } },
            entered: 0,
        })
        expect(intent).toEqual({ kind: 'delete', index: 3 })
    })

    test('base origin, row with no index: refuses to write', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: { path: 'Journal.md', note: {} },
            entered: 5,
        })
        expect(intent).toEqual({ kind: 'none' })
    })

    test('query origin, one note, a value typed: sets the property, stripping a note. prefix', () => {
        const intent = planSetValue({
            origin: 'query',
            xKey: 'date',
            yKey: 'note.words',
            date: '2026-09-14',
            row: { path: 'journal/entry-1.md', note: { words: 10 } },
            entered: 250,
        })
        expect(intent).toEqual({
            kind: 'set-property',
            path: 'journal/entry-1.md',
            key: 'words',
            value: 250,
        })
    })

    test('query origin, the row is the base file itself: never sets a property on it', () => {
        const intent = planSetValue({
            origin: 'query',
            xKey: 'date',
            yKey: 'sleep',
            date: '2026-09-14',
            row: { path: 'sleep.base.jsonl', note: {} },
            entered: 1,
            basePath: 'sleep.base.jsonl',
        })
        expect(intent).toEqual({ kind: 'none' })
    })

    test('block over a base that owns its rows: origin base writes a row, keyed by the merged y', () => {
        const intent = planSetValue({
            origin: 'base',
            xKey: 'date',
            yKey: 'sleep',
            date: '2026-09-14',
            row: undefined,
            entered: 1,
            basePath: 'sleep.base.jsonl',
        })
        expect(intent).toEqual({ kind: 'create', note: { date: '2026-09-14', sleep: 1 } })
    })

    test('query origin, no row: no write', () => {
        const intent = planSetValue({
            origin: 'query',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: undefined,
            entered: 5,
        })
        expect(intent).toEqual({ kind: 'none' })
    })

    test('query origin, cleared: no write (deleting a note property is not this control\'s job)', () => {
        const intent = planSetValue({
            origin: 'query',
            xKey: 'date',
            yKey: 'words',
            date: '2026-09-14',
            row: { path: 'journal/entry-1.md', note: { words: 10 } },
            entered: undefined,
        })
        expect(intent).toEqual({ kind: 'none' })
    })
})

describe('planToggle', () => {
    test('empty day: creates a row with just x', () => {
        const intent = planToggle({ xKey: 'date', date: '2026-09-14', rows: [] })
        expect(intent).toEqual({ kind: 'create', note: { date: '2026-09-14' } })
    })

    test('one row: deletes it', () => {
        const intent = planToggle({
            xKey: 'date',
            date: '2026-09-14',
            rows: [{ index: 5, path: 'Habits.md', note: {} }],
        })
        expect(intent).toEqual({ kind: 'delete-many', indices: [5] })
    })

    test('several rows: deletes all of them, highest index first', () => {
        const intent = planToggle({
            xKey: 'date',
            date: '2026-09-14',
            rows: [
                { index: 2, path: 'Habits.md', note: {} },
                { index: 7, path: 'Habits.md', note: {} },
                { index: 4, path: 'Habits.md', note: {} },
            ],
        })
        expect(intent).toEqual({ kind: 'delete-many', indices: [7, 4, 2] })
    })

    test('rows with no index: no write', () => {
        const intent = planToggle({
            xKey: 'date',
            date: '2026-09-14',
            rows: [{ path: 'entry.md', note: {} }],
        })
        expect(intent).toEqual({ kind: 'none' })
    })
})

describe('a day whose stored row the view hides', () => {
    const stored = [
        { index: 0, path: 'Habits.base.jsonl', note: { date: '2026-11-01', pushups: 10 } },
        { index: 1, path: 'Habits.base.jsonl', note: { date: '2026-11-02', pushups: 20 } },
    ]
    const points = [
        { date: '2026-11-01', rows: [0] },
        { date: '2026-11-02', rows: [1] },
    ]
    test('rowsOnDay maps chart indices back to rows', () => {
        expect(rowsOnDay(points, stored, '2026-11-02', r => r)).toEqual([stored[1]])
        expect(rowsOnDay(points, stored, '2026-11-03', r => r)).toEqual([])
    })
    test('a base-owned view updates the hidden row instead of creating a second one', () => {
        const row = dayRow('base', [], () => rowsOnDay(points, stored, '2026-11-02', r => r))
        expect(
            planSetValue({
                origin: 'base',
                xKey: 'date',
                yKey: 'pushups',
                date: '2026-11-02',
                row,
                entered: 30,
            }),
        ).toEqual({ kind: 'update', index: 1, note: { date: '2026-11-02', pushups: 30 } })
    })
    test('a visible row wins, and a query view never reaches for hidden rows', () => {
        expect(dayRow('base', [stored[0]], () => [stored[1]])).toBe(stored[0])
        expect(dayRow('query', [], () => [stored[1]])).toBeUndefined()
    })
})
