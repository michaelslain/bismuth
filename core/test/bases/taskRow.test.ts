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

test('rowToTask round-trips the done date and does not carry resolved, recurring or placed', () => {
    const r = row('- [x] a [done 2026-09-02] [every week]')
    const task = rowToTask(r)
    expect(task.done).toBe('2026-09-02')
    expect(task).not.toHaveProperty('resolved')
    expect(task).not.toHaveProperty('recurring')
    expect(task).not.toHaveProperty('placed')
})
