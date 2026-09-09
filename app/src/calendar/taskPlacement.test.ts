import { test, expect } from 'bun:test'
import { placedDate, daysLate, placeRows } from './taskPlacement'
import type { Row } from '../../../core/src/bases/types'

const row = (note: Record<string, unknown>): Row =>
    ({ file: { path: 'f.md', name: 'f' }, note, formula: {} }) as unknown as Row

test('scheduled places the row, due is the fallback', () => {
    expect(placedDate(row({ scheduled: '2026-09-12', due: '2026-09-14' }))).toBe('2026-09-12')
    expect(placedDate(row({ due: '2026-09-14' }))).toBe('2026-09-14')
    expect(placedDate(row({}))).toBeUndefined()
})

test('an explicit dateField pins the view and disables the fallback', () => {
    expect(placedDate(row({ scheduled: '2026-09-12', due: '2026-09-14' }), 'due')).toBe('2026-09-14')
    expect(placedDate(row({ scheduled: '2026-09-12' }), 'due')).toBeUndefined()
})

test('reads note.placed rather than recomputing scheduled ?? due', () => {
    // note.placed disagrees with scheduled/due on purpose, to prove the function trusts
    // the field taskRow.ts already computed instead of deriving its own answer.
    expect(placedDate(row({ scheduled: '2026-09-01', due: '2026-09-02', placed: '2099-01-01' }))).toBe(
        '2099-01-01',
    )
})

test('an unfinished past task lands on today, carrying how late it is', () => {
    const placed = placeRows(
        [
            row({ due: '2026-09-06', resolved: false }),
            row({ due: '2026-09-08', resolved: false }),
        ],
        '2026-09-08',
    )
    expect(placed.get('2026-09-06')).toBeUndefined()
    expect(placed.get('2026-09-08')!.map(p => p.late)).toEqual([2, 0])
})

test('a FINISHED past task stays on its own day', () => {
    const placed = placeRows([row({ due: '2026-09-06', resolved: true })], '2026-09-08')
    expect(placed.get('2026-09-06')).toHaveLength(1)
    expect(placed.get('2026-09-08')).toBeUndefined()
})

test('a task placed exactly on today is not late', () => {
    const placed = placeRows([row({ due: '2026-09-08', resolved: false })], '2026-09-08')
    expect(placed.get('2026-09-08')![0].late).toBe(0)
})

test('a task with neither date appears in no bucket', () => {
    const placed = placeRows([row({ resolved: false })], '2026-09-08')
    expect(placed.size).toBe(0)
})

test('an explicit dateField with no fallback drops a row lacking that field', () => {
    const placed = placeRows([row({ scheduled: '2026-09-08', resolved: false })], '2026-09-08', 'due')
    expect(placed.size).toBe(0)
})

test('two tasks rolling onto today keep a stable, predictable order', () => {
    const a = row({ due: '2026-09-01', resolved: false })
    const b = row({ due: '2026-09-05', resolved: false })
    const placed = placeRows([a, b], '2026-09-08')
    expect(placed.get('2026-09-08')!.map(p => p.row)).toEqual([a, b])
})

test('daysLate counts whole days', () => {
    expect(daysLate('2026-09-06', '2026-09-08')).toBe(2)
    expect(daysLate('2026-09-08', '2026-09-08')).toBe(0)
})
