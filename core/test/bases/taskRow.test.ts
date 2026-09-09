import { test, expect } from 'bun:test'
import { taskToRow, rowToTask } from '../../src/bases/taskRow'
import { parseTaskLine } from '../../src/tasks'

const row = (line: string) => taskToRow(parseTaskLine(line, 'f.md', 0)!)

test('resolved covers done and cancelled', () => {
    expect(row('- [x] a').note.resolved).toBe(true)
    expect(row('- [-] a').note.resolved).toBe(true)
    expect(row('- [ ] a').note.resolved).toBe(false)
    expect(row('- [/] a').note.resolved).toBe(false)
})

test('done stays the raw done-date, independent of resolved', () => {
    const r = row('- [x] a [done 2026-09-02]')
    expect(r.note.done).toBe('2026-09-02')
    expect(r.note.resolved).toBe(true)
})

test('placed is scheduled first, due as the fallback', () => {
    expect(
        row('- [ ] a [scheduled 2026-09-01] [due 2026-09-30]').note.placed,
    ).toBe('2026-09-01')
    expect(row('- [ ] a [due 2026-09-30]').note.placed).toBe('2026-09-30')
    expect(row('- [ ] a').note.placed).toBeUndefined()
})

test('recurring follows the recurrence field', () => {
    expect(row('- [ ] a [every week]').note.recurring).toBe(true)
    expect(row('- [ ] a').note.recurring).toBe(false)
})

test('a row exposes all six date fields, not just the four the calendar uses', () => {
    // created/cancelled were missing from note.* until this was caught: the DSL
    // translator emits filters against all six DATE_FIELD_NAMES, so a row silently
    // dropping two of them made "created before today" / "cancelled after …" match
    // nothing, with no error — a silent regression, not a mere gap.
    const r = row(
        '- [-] a [due 2026-09-05] [scheduled 2026-09-01] [start 2026-08-28] ' +
            '[done 2026-09-02] [created 2026-08-01] [cancelled 2026-09-03]',
    )
    expect(r.note.due).toBe('2026-09-05')
    expect(r.note.scheduled).toBe('2026-09-01')
    expect(r.note.start).toBe('2026-08-28')
    expect(r.note.done).toBe('2026-09-02')
    expect(r.note.created).toBe('2026-08-01')
    expect(r.note.cancelled).toBe('2026-09-03')
})

test('rowToTask round-trips created and cancelled alongside the other four date fields', () => {
    const r = row(
        '- [-] a [due 2026-09-05] [scheduled 2026-09-01] [start 2026-08-28] ' +
            '[done 2026-09-02] [created 2026-08-01] [cancelled 2026-09-03]',
    )
    const task = rowToTask(r)
    expect(task.due).toBe('2026-09-05')
    expect(task.scheduled).toBe('2026-09-01')
    expect(task.start).toBe('2026-08-28')
    expect(task.done).toBe('2026-09-02')
    expect(task.created).toBe('2026-08-01')
    expect(task.cancelled).toBe('2026-09-03')
})

test('rowToTask round-trips the done date and does not carry resolved, recurring or placed', () => {
    const r = row('- [x] a [done 2026-09-02] [every week]')
    const task = rowToTask(r)
    expect(task.done).toBe('2026-09-02')
    expect(task).not.toHaveProperty('resolved')
    expect(task).not.toHaveProperty('recurring')
    expect(task).not.toHaveProperty('placed')
})
