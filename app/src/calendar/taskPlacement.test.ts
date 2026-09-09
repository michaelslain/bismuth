import { test, expect } from 'bun:test'
import { placedDate, daysLate, placeRows, placementField } from './taskPlacement'
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

test('an empty-string date is treated as absent, not as an early day', () => {
    expect(placedDate(row({ due: '' }))).toBeUndefined()
    const placed = placeRows([row({ due: '', resolved: false })], '2026-09-08')
    expect(placed.size).toBe(0)
})

test('a null note.placed falls through to scheduled instead of being read literally', () => {
    expect(placedDate(row({ placed: null, scheduled: '2026-09-01' }))).toBe('2026-09-01')
})

test('a non-string note.placed is treated as absent, not returned as-is', () => {
    expect(placedDate(row({ placed: 42 }))).toBeUndefined()
})

test('an explicit dateField naming an invalid value is unplaced, not the raw value', () => {
    expect(placedDate(row({ due: '' }), 'due')).toBeUndefined()
})

test('an unresolved task placed in the future stays on its own future day', () => {
    const placed = placeRows([row({ due: '2026-09-10', resolved: false })], '2026-09-08')
    expect(placed.get('2026-09-10')).toHaveLength(1)
    expect(placed.get('2026-09-08')).toBeUndefined()
})

test('a resolved task placed in the future stays on its own future day', () => {
    const placed = placeRows([row({ due: '2026-09-10', resolved: true })], '2026-09-08')
    expect(placed.get('2026-09-10')).toHaveLength(1)
    expect(placed.get('2026-09-08')).toBeUndefined()
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

// --- placementField: which field to REWRITE on a drag reschedule ---

test('placementField prefers scheduled, falls back to due', () => {
    expect(placementField(row({ scheduled: '2026-09-12', due: '2026-09-14' }))).toBe(
        'scheduled',
    )
    expect(placementField(row({ due: '2026-09-14' }))).toBe('due')
    expect(placementField(row({}))).toBeUndefined()
})

test('placementField honors an explicit dateField, with no fallback', () => {
    expect(
        placementField(row({ scheduled: '2026-09-12', due: '2026-09-14' }), 'due'),
    ).toBe('due')
    expect(placementField(row({ scheduled: '2026-09-12' }), 'due')).toBeUndefined()
})

test('placementField treats an invalid value as absent, same as placedDate', () => {
    expect(placementField(row({ due: '' }))).toBeUndefined()
    expect(placementField(row({ due: 42 }))).toBeUndefined()
})

test('placeRows attaches the placement field to every entry it buckets', () => {
    const placed = placeRows(
        [
            row({ scheduled: '2026-09-08', resolved: false }),
            row({ due: '2026-09-08', resolved: false }),
        ],
        '2026-09-08',
    )
    const entries = placed.get('2026-09-08')!
    expect(entries[0].field).toBe('scheduled')
    expect(entries[1].field).toBe('due')
})

test('a carried task still reports the ORIGINAL field it would be rewritten through', () => {
    const placed = placeRows(
        [row({ due: '2026-09-01', resolved: false })],
        '2026-09-08',
    )
    expect(placed.get('2026-09-08')![0].field).toBe('due')
})
