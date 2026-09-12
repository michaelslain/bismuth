import { test, expect } from 'bun:test'
import {
    taskToRow,
    rowToTask,
    normalizeStoredTaskRow,
} from '../../src/bases/taskRow'
import { syntheticBaseFile } from '../../src/bases/types'
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

// ---- normalizeStoredTaskRow: the SECOND producer of the one task-row shape ----
// A task stored as a YAML row in a base file carries only what the user wrote. These
// tests pin that it comes out the same shape a scanned checkbox line does, so nothing
// downstream can tell the two apart.

const stored = (note: Record<string, unknown>) =>
    normalizeStoredTaskRow({
        file: syntheticBaseFile('B.md'),
        note,
        formula: {},
        index: 0,
    })

test('a stored row gets the same derived fields as a scanned one', () => {
    const r = stored({
        description: 'ship it',
        status: 'todo',
        due: '2026-09-20',
    })
    expect(r.note.statusChar).toBe(' ')
    expect(r.note.resolved).toBe(false)
    expect(r.note.placed).toBe('2026-09-20')
    expect(r.note.recurring).toBe(false)
})

test('scheduled beats due for placement, same as a scanned row', () => {
    const r = stored({
        description: 'x',
        status: 'todo',
        due: '2026-09-20',
        scheduled: '2026-09-18',
    })
    expect(r.note.placed).toBe('2026-09-18')
})

test('a stored row with no status reads as todo', () => {
    const r = stored({ description: 'x' })
    expect(r.note.status).toBe('todo')
    expect(r.note.resolved).toBe(false)
})

test('a stored done row is resolved and carries the done box char', () => {
    const r = stored({ description: 'x', status: 'done', done: '2026-09-09' })
    expect(r.note.statusChar).toBe('x')
    expect(r.note.resolved).toBe(true)
})

test('a stored recurring row reports recurring', () => {
    const r = stored({ description: 'rent', recurrence: 'every month' })
    expect(r.note.recurring).toBe(true)
})

test('normalizeStoredTaskRow keeps the write-back handle and does not mutate its input', () => {
    const note = { description: 'x' }
    const r = normalizeStoredTaskRow({
        file: syntheticBaseFile('B.md'),
        note,
        formula: {},
        index: 3,
    })
    expect(r.index).toBe(3)
    expect(r.file.path).toBe('B.md')
    expect(note).toEqual({ description: 'x' })
})

test('a user column sharing a computed name is not overwritten', () => {
    const r = stored({
        description: 'shelve it',
        status: 'todo',
        placed: 'shelf 3',
        resolved: 'by ana',
        recurring: 'weekly-ish',
    })
    expect(r.note.placed).toBe('shelf 3')
    expect(r.note.resolved).toBe('by ana')
    expect(r.note.recurring).toBe('weekly-ish')
    // and none of the three is recorded as filled, so a write cannot strip them
    expect(r.derived).not.toContain('placed')
    expect(r.derived).not.toContain('resolved')
    expect(r.derived).not.toContain('recurring')
})

test('normalizeStoredTaskRow records exactly the columns it filled in', () => {
    const r = stored({ description: 'x', status: 'todo', priority: 'high' })
    expect([...(r.derived ?? [])].sort()).toEqual([
        'placed',
        'recurring',
        'resolved',
        'statusChar',
        'tags',
    ])
    // status and priority were stored, so they are not the normalizer's to strip
    expect(r.derived).not.toContain('status')
    expect(r.derived).not.toContain('priority')
})

test('normalizing twice does not mistake a filled key for a stored column', () => {
    const once = stored({ description: 'x' })
    const twice = normalizeStoredTaskRow(once)
    expect([...(twice.derived ?? [])].sort()).toEqual(
        [...(once.derived ?? [])].sort(),
    )
    expect(twice.note).toEqual(once.note)
})

test('the two producers agree field for field for the same logical task', () => {
    // The whole point of tasks mode: a stored task and a scanned task must be
    // indistinguishable downstream. `priority` and `tags` are the ones that bit — taskToRow
    // emits "none" and [] unconditionally, so a stored row omitting them sorted and filtered
    // differently purely by where it lived.
    const scanned = row('- [ ] ship it [due 2026-09-20]').note
    const storedNote = stored({
        description: 'ship it',
        due: '2026-09-20',
    }).note
    // line/raw are the ONE deliberate difference: they are the origin discriminator the
    // write seam keys off, and a stored row has no source line to carry them.
    const comparable = (n: Record<string, unknown>) => {
        const out = { ...n }
        delete out.line
        delete out.raw
        return out
    }
    expect(comparable(storedNote)).toEqual(comparable(scanned))
})

test('a stored row without a priority column filters and sorts as "none", like a scanned one', () => {
    // `priority is none` translates to `note.priority == "none"`, which matched a scanned
    // task and not a stored one before this default existed.
    expect(stored({ description: 'x' }).note.priority).toBe('none')
    expect(row('- [ ] x').note.priority).toBe('none')
    expect(stored({ description: 'x' }).note.tags).toEqual([])
    expect(row('- [ ] x').note.tags).toEqual([])
})
