import { test, expect } from 'bun:test'
import {
    toggleStoredTask,
    setStoredTaskStatus,
    canWriteStoredRow,
    isStoredPlaceholder,
    storedNote,
} from './taskWrite'
import { normalizeStoredTaskRow } from '../../../core/src/bases/taskRow'
import { syntheticBaseFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'

// Every test goes through the normalizer, because that is how a row reaches the seam: a view
// renders normalized rows and hands one straight back. Testing the seam on a hand-built note
// would miss the whole class of bug this file exists to pin — a write that persists what
// normalization added, or deletes a column it did not add.
const row = (note: Record<string, unknown>): Row =>
    normalizeStoredTaskRow({
        file: syntheticBaseFile('B.md'),
        note,
        formula: {},
        index: 0,
    })

test('toggling a stored task sets done and stamps the date', () => {
    const { note } = toggleStoredTask(
        row({ description: 'x', status: 'todo' }),
        '2026-09-09',
    )
    expect(note.status).toBe('done')
    expect(note.done).toBe('2026-09-09')
})

test('un-toggling clears the done date', () => {
    const { note } = toggleStoredTask(
        row({ description: 'x', status: 'done', done: '2026-09-09' }),
        '2026-09-10',
    )
    expect(note.status).toBe('todo')
    expect(note.done).toBeUndefined()
})

test('completing a recurring stored task spawns the next occurrence', () => {
    const { note, next } = toggleStoredTask(
        row({
            description: 'rent',
            status: 'todo',
            due: '2026-09-12',
            recurrence: 'every month',
        }),
        '2026-09-09',
    )
    expect(note.status).toBe('done')
    expect(next).toEqual({
        description: 'rent',
        status: 'todo',
        due: '2026-10-12',
        recurrence: 'every month',
    })
})

test('a recurring stored task with no date spawns nothing', () => {
    const { next } = toggleStoredTask(
        row({ description: 'rent', status: 'todo', recurrence: 'every month' }),
        '2026-09-09',
    )
    expect(next).toBeUndefined()
})

test('setting a non-done status clears the done date', () => {
    const out = setStoredTaskStatus(
        row({ description: 'x', status: 'done', done: '2026-09-09' }),
        'in-progress',
        '2026-09-10',
    )
    expect(out.note.status).toBe('in-progress')
    expect(out.note.done).toBeUndefined()
})

// ---- the same rules toggleTaskLine follows, asserted on the stored spelling ----

test('only the schedulable dates roll forward', () => {
    const { next } = toggleStoredTask(
        row({
            description: 'x',
            status: 'todo',
            due: '2026-09-12',
            scheduled: '2026-09-10',
            start: '2026-09-08',
            created: '2026-08-01',
            recurrence: 'every week',
        }),
        '2026-09-09',
    )
    expect(next!.due).toBe('2026-09-19')
    expect(next!.scheduled).toBe('2026-09-17')
    expect(next!.start).toBe('2026-09-15')
    // created never recurs — it is when the task was written, not when it is due
    expect(next!.created).toBe('2026-08-01')
})

test('the spawned occurrence carries no done or cancelled date', () => {
    // A deliberate divergence from the markdown path, which copies the body verbatim and so
    // carries a stale hand-written marker onto the next occurrence. Nothing else pins it:
    // deleting both `delete` lines leaves every other test in this file green.
    const { next } = toggleStoredTask(
        row({
            description: 'rent',
            status: 'todo',
            due: '2026-09-12',
            done: '2026-08-12',
            cancelled: '2026-07-12',
            recurrence: 'every month',
        }),
        '2026-09-09',
    )
    expect(next).toBeDefined()
    expect(next).not.toHaveProperty('done')
    expect(next).not.toHaveProperty('cancelled')
    expect(next!.status).toBe('todo')
    expect(next!.due).toBe('2026-10-12')
})

test('an unrecognised recurrence rule spawns nothing', () => {
    const { next } = toggleStoredTask(
        row({
            description: 'x',
            status: 'todo',
            due: '2026-09-12',
            recurrence: 'every blue moon',
        }),
        '2026-09-09',
    )
    expect(next).toBeUndefined()
})

test('the completed occurrence keeps its own dates', () => {
    const { note } = toggleStoredTask(
        row({
            description: 'rent',
            status: 'todo',
            due: '2026-09-12',
            recurrence: 'every month',
        }),
        '2026-09-09',
    )
    expect(note.due).toBe('2026-09-12')
    expect(note.done).toBe('2026-09-09')
})

test('an existing done date is not overwritten on completion', () => {
    // mirrors withDone(): a done-date already on the task stands
    const { note } = toggleStoredTask(
        row({ description: 'x', status: 'todo', done: '2026-09-01' }),
        '2026-09-09',
    )
    expect(note.status).toBe('done')
    expect(note.done).toBe('2026-09-01')
})

test('a stored task with no status toggles to done', () => {
    const { note } = toggleStoredTask(row({ description: 'x' }), '2026-09-09')
    expect(note.status).toBe('done')
    expect(note.done).toBe('2026-09-09')
})

test('toggling a cancelled stored task completes it rather than un-completing it', () => {
    // toggleTaskLine flips on the DONE box char only — a cancelled task is not done,
    // so ticking it completes it. Same rule here.
    const { note } = toggleStoredTask(
        row({ description: 'x', status: 'cancelled' }),
        '2026-09-09',
    )
    expect(note.status).toBe('done')
})

test('setting done stamps the date and spawns the next occurrence', () => {
    const { note, next } = setStoredTaskStatus(
        row({
            description: 'rent',
            status: 'todo',
            due: '2026-09-12',
            recurrence: 'every month',
        }),
        'done',
        '2026-09-09',
    )
    expect(note.done).toBe('2026-09-09')
    expect(next!.due).toBe('2026-10-12')
})

test('neither write mutates the row it was handed', () => {
    const note = { description: 'x', status: 'todo' }
    const r = row(note)
    const before = JSON.stringify(r.note)
    toggleStoredTask(r, '2026-09-09')
    setStoredTaskStatus(r, 'done', '2026-09-09')
    expect(JSON.stringify(r.note)).toBe(before)
    expect(note).toEqual({ description: 'x', status: 'todo' })
})

// ---- what a write may and may not change about the user's columns ----

test('a write persists no column the user did not have', () => {
    const { note } = toggleStoredTask(
        row({ description: 'x', due: '2026-09-20' }),
        '2026-09-09',
    )
    // status is set by the write itself, and done is its stamp — everything else the
    // normalizer added (statusChar, priority, tags, resolved, placed, recurring) is gone
    expect(Object.keys(note).sort()).toEqual([
        'description',
        'done',
        'due',
        'status',
    ])
})

test('a user column sharing a computed name survives a write intact', () => {
    // A base is a table; these names are not reserved. Someone can have a `placed` column
    // holding a shelf, a `resolved` column holding a person, a `recurring` column holding a
    // cadence in their own words. Stripping by NAME deleted all three on one checkbox tick.
    const stored = {
        description: 'shelve it',
        status: 'todo',
        placed: 'shelf 3',
        resolved: 'by ana',
        recurring: 'weekly-ish',
    }
    const r = row(stored)
    // the view shows the user's values, not computed ones standing in front of them
    expect(r.note.placed).toBe('shelf 3')
    expect(r.note.resolved).toBe('by ana')
    expect(r.note.recurring).toBe('weekly-ish')

    const { note } = toggleStoredTask(r, '2026-09-09')
    expect(note.placed).toBe('shelf 3')
    expect(note.resolved).toBe('by ana')
    expect(note.recurring).toBe('weekly-ish')
    expect(note.description).toBe('shelve it')
})

test('a spawned occurrence keeps the user columns too', () => {
    const { next } = toggleStoredTask(
        row({
            description: 'rent',
            status: 'todo',
            due: '2026-09-12',
            recurrence: 'every month',
            placed: 'shelf 3',
        }),
        '2026-09-09',
    )
    expect(next!.placed).toBe('shelf 3')
    expect(next).not.toHaveProperty('statusChar')
})

test('a row that was never normalized strips nothing rather than guessing', () => {
    // The safe direction: with no `derived` record the write cannot know which keys are the
    // user's, so it removes none. At worst a computed value is persisted; a stored column is
    // never deleted.
    const { note } = toggleStoredTask(
        {
            file: syntheticBaseFile('B.md'),
            note: { description: 'x', placed: 'shelf 3' },
            formula: {},
            index: 0,
        },
        '2026-09-09',
    )
    expect(note.placed).toBe('shelf 3')
})

// ---- the per-ROW write-back test ----

test('a row with an index can be written back; one without cannot', () => {
    const file = syntheticBaseFile('B.md')
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: 0 })).toBe(
        true,
    )
    // index 0 is a real handle — a falsy check here would make the FIRST row read-only
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: 4 })).toBe(
        true,
    )
    expect(canWriteStoredRow({ file, note: {}, formula: {} })).toBe(false)
    // typeof NaN is 'number' and so is 2.5 — neither is a row position, and the server
    // rejects both, so the affordance must not be offered for them either
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: NaN })).toBe(
        false,
    )
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: 2.5 })).toBe(
        false,
    )
})

test('a negative index cannot be written back — it is a pending placeholder, not a handle', () => {
    const file = syntheticBaseFile('B.md')
    // Against the OLD implementation (`Number.isInteger(row.index)` alone) this is `true`:
    // a placeholder's index is a real integer, just a negative one, so the old guard would
    // hand out a write affordance for a row the server has never assigned a slot to.
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: -1 })).toBe(
        false,
    )
    expect(canWriteStoredRow({ file, note: {}, formula: {}, index: -2 })).toBe(
        false,
    )
})

test('isStoredPlaceholder names exactly the negative-index case', () => {
    const file = syntheticBaseFile('B.md')
    // Against the OLD taskWrite.ts this test cannot even compile — `isStoredPlaceholder` did
    // not exist. Its behaviour is the other half of the same ruling as the test above: a
    // negative index IS a placeholder, a non-negative one is NOT, and a row with no index at
    // all (unwritable, but not pending — it was never a stored row to begin with) is NOT.
    expect(
        isStoredPlaceholder({ file, note: {}, formula: {}, index: -1 }),
    ).toBe(true)
    expect(
        isStoredPlaceholder({ file, note: {}, formula: {}, index: 0 }),
    ).toBe(false)
    expect(
        isStoredPlaceholder({ file, note: {}, formula: {}, index: 4 }),
    ).toBe(false)
    expect(isStoredPlaceholder({ file, note: {}, formula: {} })).toBe(false)
    expect(
        isStoredPlaceholder({ file, note: {}, formula: {}, index: NaN }),
    ).toBe(false)
})

test('storedNote is the exported strip every write path must build its note from', () => {
    // serializeRows does NOT strip: handed a normalized row it writes all seven computed
    // columns into the user's base body. Any write starting from a row a view holds — a cell
    // edit, a kanban drag, a calendar reschedule — has to go through this.
    const r = row({ description: 'x', due: '2026-09-20' })
    expect(Object.keys(r.note).sort()).toEqual([
        'description',
        'due',
        'placed',
        'priority',
        'recurring',
        'resolved',
        'status',
        'statusChar',
        'tags',
    ])
    expect(Object.keys(storedNote(r)).sort()).toEqual(['description', 'due'])
    // a reschedule built the safe way keeps the user's row and changes one field
    expect({ ...storedNote(r), due: '2026-10-01' }).toEqual({
        description: 'x',
        due: '2026-10-01',
    })
})
