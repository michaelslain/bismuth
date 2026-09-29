import { test, expect } from 'bun:test'
import {
    composeColumns,
    composeTargets,
    declaredCategoriesWith,
    newStoredTaskNote,
    sourcedTaskBody,
    taskFileTargetId,
} from './tasksCalendarWrites'
import type { Row } from '../../../core/src/bases/types'

const lineRow = (path: string, name: string): Row =>
    ({ file: { path, name }, note: { line: 1, description: 'x' } }) as unknown as Row

test('taskFileTargetId resolves a basename ref to the note already on the grid', () => {
    expect(taskFileTargetId(['tasks/General Tasks.md'], '[[General Tasks]]')).toBe(
        'tasks/General Tasks.md',
    )
    expect(taskFileTargetId([], undefined)).toBe('')
    expect(taskFileTargetId([], '[[Inbox]]')).toBe('Inbox.md')
})

test('composeTargets (sourced) lists each source note once, then the taskFile', () => {
    const colors = new Map([['a', 'var(--teal)']])
    const t = composeTargets({
        rows: [lineRow('n/a.md', 'a'), lineRow('n/a.md', 'a')],
        ownsRows: false,
        declared: [],
        names: [],
        colors,
        taskFile: '[[b]]',
    })
    expect(t).toEqual([
        { id: 'n/a.md', label: 'a', color: 'var(--teal)' },
        { id: 'b.md', label: 'b', color: undefined },
    ])
})

test('composeTargets (owned rows) leads with no category, dedupes seen + declared', () => {
    const t = composeTargets({
        rows: [],
        ownsRows: true,
        declared: ['home', 'work'],
        names: ['work'],
        colors: new Map(),
        taskFile: undefined,
    })
    expect(t.map(x => x.id)).toEqual(['', 'work', 'home'])
    expect(t[0].label).toBe('no category')
})

test('newStoredTaskNote puts description first and only adds a category when picked', () => {
    expect(newStoredTaskNote('call', '2026-01-02', 'category', '')).toEqual({
        description: 'call',
        status: 'todo',
        scheduled: '2026-01-02',
    })
    const n = newStoredTaskNote('call', '2026-01-02', 'kind', 'home')
    expect(n.kind).toBe('home')
    expect(Object.keys(n)[0]).toBe('description')
})

test('sourcedTaskBody appends the scheduled field', () => {
    expect(sourcedTaskBody('call', '2026-01-02')).toBe('call [scheduled 2026-01-02]')
})

test('composeColumns hides the parser handles', () => {
    const r = { file: { path: 'a', name: 'a' }, note: { line: 1, resolved: true, statusChar: ' ', placed: 1, description: 'x', due: 'y' } } as unknown as Row
    expect(composeColumns([r])).toEqual(['description', 'due'])
})

test('declaredCategoriesWith replaces in place or appends', () => {
    const d = [{ name: 'a', color: 'teal' }]
    expect(declaredCategoriesWith(d, 'a', 'rose')).toEqual([{ name: 'a', color: 'rose' }])
    expect(declaredCategoriesWith(d, 'b', 'rose')).toEqual([
        { name: 'a', color: 'teal' },
        { name: 'b', color: 'rose' },
    ])
})
