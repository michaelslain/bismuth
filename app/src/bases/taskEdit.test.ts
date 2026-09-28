import { afterAll, test, expect } from 'bun:test'
import type { Row } from '../../../core/src/bases/types'
import {
    syntheticBaseFile,
    placeholderFile,
} from '../../../core/src/bases/types'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { isEditableTask, updateTask, deleteTask, moveTask } from './taskEdit'

// The api is stubbed at its Transport seam, NOT with `mock.module('../api', …)`: a module mock
// is process-global in Bun, so it strips every other `api.*` method from every test file that
// runs after this one (treeStore.test.ts's header records the same trap). Each POST is mapped
// back to the api method that sent it, so the assertions read in api terms.
const calls: { name: string; args: unknown[] }[] = []
const ROUTES: Record<
    string,
    (b: Record<string, unknown>) => { name: string; args: unknown[] }
> = {
    '/tasks/update': b => ({
        name: 'updateTaskLine',
        args: [b.path, b.line, b.patch],
    }),
    '/tasks/delete': b => ({ name: 'deleteTaskLine', args: [b.path, b.line] }),
    '/tasks/move': b => ({
        name: 'moveTaskLine',
        args: [b.path, b.line, b.to],
    }),
    '/row/update': b => ({
        name: 'rowUpdate',
        args: [b.file, b.index, b.note],
    }),
    '/row/delete': b => ({ name: 'rowDelete', args: [b.file, b.index] }),
}
function recordPost(path: string, body: unknown) {
    calls.push(ROUTES[path](body as Record<string, unknown>))
}
const originalBase = apiBase()
const stub: Transport = {
    getJson: () => Promise.reject(new Error('not stubbed')),
    getText: () => Promise.reject(new Error('not stubbed')),
    post: (path, body) => {
        recordPost(path, body)
        return Promise.resolve(new Response('ok'))
    },
    put: () => Promise.reject(new Error('not stubbed')),
    postJson: <T>(path: string, body: unknown) => {
        recordPost(path, body)
        return Promise.resolve({ path: 'dest.md' } as T)
    },
    writeFileChecked: () => Promise.reject(new Error('not stubbed')),
    uploadAsset: () => Promise.reject(new Error('not stubbed')),
    convertHeic: () => Promise.reject(new Error('not stubbed')),
    stageTmpFile: () => Promise.reject(new Error('not stubbed')),
    assetUrl: (t: string) => t,
    eventsUrl: () => '',
    base: () => originalBase,
}
setTransport(stub)
afterAll(() => setTransport(httpTransport(originalBase)))

function lineRow(overrides: Partial<Row['note']> = {}): Row {
    return {
        file: placeholderFile('Note', 'notes/a.md'),
        note: { line: 3, description: 'buy milk', ...overrides },
        formula: {},
    }
}

function storedRow(index = 2, overrides: Partial<Row['note']> = {}): Row {
    return {
        file: syntheticBaseFile('tasks.md'),
        note: { description: 'buy milk', status: 'todo', ...overrides },
        formula: {},
        index,
    }
}

test('isEditableTask: true for a line task', () => {
    expect(isEditableTask(lineRow())).toBe(true)
})

test('isEditableTask: true for a writable stored row', () => {
    expect(isEditableTask(storedRow(0))).toBe(true)
})

test('isEditableTask: false for a placeholder stored row (negative index)', () => {
    expect(isEditableTask(storedRow(-1))).toBe(false)
})

test('isEditableTask: false for a row with no line and no index', () => {
    const row: Row = {
        file: placeholderFile('Note', 'notes/a.md'),
        note: { description: 'x' },
        formula: {},
    }
    expect(isEditableTask(row)).toBe(false)
})

test('updateTask on a line task calls updateTaskLine with the patch', async () => {
    calls.length = 0
    await updateTask(lineRow(), {
        description: 'buy oat milk',
        due: '2026-09-14',
    })
    expect(calls).toEqual([
        {
            name: 'updateTaskLine',
            args: [
                'notes/a.md',
                3,
                {
                    description: 'buy oat milk',
                    due: '2026-09-14',
                    scheduled: undefined,
                    priority: undefined,
                },
            ],
        },
    ])
})

test('updateTask on a stored row calls rowUpdate with storedNote merged with the patch', async () => {
    calls.length = 0
    await updateTask(storedRow(2), {
        description: 'new text',
        priority: 'high',
    })
    expect(calls).toEqual([
        {
            name: 'rowUpdate',
            args: [
                'tasks.md',
                2,
                { description: 'new text', status: 'todo', priority: 'high' },
            ],
        },
    ])
})

test('updateTask on a stored row with category writes the category field', async () => {
    calls.length = 0
    await updateTask(
        storedRow(2, { category: 'old' }),
        { category: 'work' },
        { categoryField: 'category' },
    )
    expect(calls[0].args[2]).toMatchObject({ category: 'work' })
})

test('updateTask clears a field with null', async () => {
    calls.length = 0
    await updateTask(storedRow(2, { due: '2026-01-01' }), { due: null })
    const note = calls[0].args[2] as Record<string, unknown>
    expect('due' in note).toBe(false)
})

test('deleteTask on a line task calls deleteTaskLine', async () => {
    calls.length = 0
    await deleteTask(lineRow())
    expect(calls).toEqual([{ name: 'deleteTaskLine', args: ['notes/a.md', 3] }])
})

test('deleteTask on a stored row calls rowDelete', async () => {
    calls.length = 0
    await deleteTask(storedRow(2))
    expect(calls).toEqual([{ name: 'rowDelete', args: ['tasks.md', 2] }])
})

test('moveTask on a line task calls moveTaskLine and returns the new path', async () => {
    calls.length = 0
    const path = await moveTask(lineRow(), '[[Other Note]]')
    expect(calls).toEqual([
        { name: 'moveTaskLine', args: ['notes/a.md', 3, '[[Other Note]]'] },
    ])
    expect(path).toBe('dest.md')
})

test('moveTask on a stored row throws', async () => {
    await expect(moveTask(storedRow(2), '[[Other]]')).rejects.toThrow()
})
