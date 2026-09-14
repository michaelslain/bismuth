import { test, expect } from 'bun:test'
import { placedDate, daysLate, placeRows, placementField, isTaskLine } from './taskPlacement'
import type { Row } from '../../../core/src/bases/types'
import type { PlacedTask } from './taskPlacement'

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

// --- isTaskLine: the ONE predicate gating every WRITE (toggle, status, drag-reschedule) ---

test('isTaskLine requires a real markdown line number AND a resolvable placement field', () => {
    const t: PlacedTask = {
        row: row({ line: 3, scheduled: '2026-09-08' }),
        placed: '2026-09-08',
        late: 0,
        field: 'scheduled',
    }
    expect(isTaskLine(t)).toBe(true)
})

test('isTaskLine is false for a self-owned row with no source markdown line', () => {
    const t: PlacedTask = {
        row: row({ scheduled: '2026-09-08' }), // no note.line — a YAML row, not a checkbox line
        placed: '2026-09-08',
        late: 0,
        field: 'scheduled',
    }
    expect(isTaskLine(t)).toBe(false)
})

test('isTaskLine is false when the placement field could not be resolved, even with a line', () => {
    const t: PlacedTask = {
        row: row({ line: 3 }),
        placed: '2026-09-08',
        late: 0,
        field: undefined,
    }
    expect(isTaskLine(t)).toBe(false)
})

test('each day lists its most-overdue carried task first, then its own tasks in file order', () => {
    const today = '2026-09-13'
    const rows = [
        row({ scheduled: '2026-09-08', resolved: false, description: 'five late' }),
        row({ scheduled: '2026-09-13', resolved: false, description: 'own A' }),
        row({ scheduled: '2026-08-21', resolved: false, description: 'twenty-three late' }),
        row({ scheduled: '2026-09-13', resolved: false, description: 'own B' }),
        row({ scheduled: '2026-09-12', resolved: false, description: 'one late' }),
    ]
    const bucket = placeRows(rows, today).get(today)!
    expect(bucket.map(t => t.row.note.description)).toEqual([
        'twenty-three late',
        'five late',
        'one late',
        'own A',
        'own B',
    ])
    expect(bucket.map(t => t.late)).toEqual([23, 5, 1, 0, 0])
})

// Guard, not a red test: pins that the sort is by lateness ONLY and stable, so a later "tidy"
// that sorts by status or description would fail here.
test('a day with nothing carried keeps file order, resolved or not', () => {
    const rows = [
        row({ scheduled: '2026-09-20', resolved: true, description: 'b done' }),
        row({ scheduled: '2026-09-20', resolved: false, description: 'a todo' }),
    ]
    const bucket = placeRows(rows, '2026-09-13').get('2026-09-20')!
    expect(bucket.map(t => t.row.note.description)).toEqual(['b done', 'a todo'])
})

// --- placeRows(prev): identity reuse for unchanged rows, so <For> keeps their DOM nodes ---

test('an unchanged row reuses its previous PlacedTask object', () => {
    const a = row({ scheduled: '2026-09-08', resolved: false, description: 'a' })
    const b = row({ scheduled: '2026-09-09', resolved: false, description: 'b' })
    const today = '2026-09-08'
    const prev = placeRows([a, b], today)
    const prevA = prev.get('2026-09-08')![0]
    const prevB = prev.get('2026-09-09')![0]

    const next = placeRows([a, b], today, undefined, prev)

    expect(next.get('2026-09-08')![0]).toBe(prevA)
    expect(next.get('2026-09-09')![0]).toBe(prevB)
})

test('a row whose Row object changed gets a new PlacedTask entry', () => {
    const a1 = row({ scheduled: '2026-09-08', resolved: false, description: 'a' })
    const today = '2026-09-08'
    const prev = placeRows([a1], today)
    const prevEntry = prev.get('2026-09-08')![0]

    // A different Row object, same field values — reconcileViewResult would only ever hand
    // this function a new object when the row itself actually changed, but placeRows must
    // not assume that: identity is the ONLY thing it trusts.
    const a2 = row({ scheduled: '2026-09-08', resolved: false, description: 'a' })
    const next = placeRows([a2], today, undefined, prev)
    const nextEntry = next.get('2026-09-08')![0]

    expect(nextEntry).not.toBe(prevEntry)
    expect(nextEntry.row).toBe(a2)
})

test('a same-row entry whose lateness changed against a new today gets a new entry', () => {
    const a = row({ scheduled: '2026-09-01', resolved: false, description: 'a' })
    const prev = placeRows([a], '2026-09-05')
    const prevEntry = prev.get('2026-09-05')![0]
    expect(prevEntry.late).toBe(4)

    const next = placeRows([a], '2026-09-08', undefined, prev)
    const nextEntry = next.get('2026-09-08')![0]

    expect(nextEntry).not.toBe(prevEntry)
    expect(nextEntry.late).toBe(7)
    expect(nextEntry.row).toBe(a)
})

test('placeRows(prev) still buckets and orders exactly like placeRows without prev', () => {
    const today = '2026-09-13'
    const rows = [
        row({ scheduled: '2026-09-08', resolved: false, description: 'five late' }),
        row({ scheduled: '2026-09-13', resolved: false, description: 'own A' }),
        row({ scheduled: '2026-08-21', resolved: false, description: 'twenty-three late' }),
        row({ scheduled: '2026-09-13', resolved: false, description: 'own B' }),
        row({ scheduled: '2026-09-12', resolved: false, description: 'one late' }),
    ]
    const withoutPrev = placeRows(rows, today)
    const prev = placeRows(rows.slice(0, 1), today)
    const withPrev = placeRows(rows, today, undefined, prev)

    expect([...withPrev.keys()]).toEqual([...withoutPrev.keys()])
    expect(withPrev.get(today)!.map(t => t.row.note.description)).toEqual(
        withoutPrev.get(today)!.map(t => t.row.note.description),
    )
    expect(withPrev.get(today)!.map(t => t.late)).toEqual(withoutPrev.get(today)!.map(t => t.late))
})
