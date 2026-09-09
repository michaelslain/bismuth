import { test, expect } from 'bun:test'
import { taskToRow } from '../../src/bases/tasksData'
import type { Task } from '../../src/tasks'

function mkTask(over: Partial<Task>): Task {
    return {
        path: 'a.md',
        line: 0,
        raw: '- [ ] x',
        indent: '',
        status: 'todo',
        statusChar: ' ',
        description: 'x',
        priority: 'none',
        tags: [],
        ...over,
    } as Task
}

test('taskToRow maps task fields into Row.note, one row per checkbox', () => {
    const row = taskToRow(
        mkTask({
            path: 'journal/2026-05-30.md',
            line: 4,
            description: 'call mom',
            due: '2026-06-01',
        }),
    )
    expect(row.note.description).toBe('call mom')
    expect(row.note.status).toBe('todo')
    expect(row.note.due).toBe('2026-06-01')
    expect(row.file.path).toBe('journal/2026-05-30.md')
    expect(row.file.name).toBe('2026-05-30')
    expect(row.file.folder).toBe('journal')
    expect(row.note.line).toBe(4) // line preserved for write-back
})
