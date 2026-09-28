import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import type { Row } from '../../../core/src/bases/types'
import {
    initialTaskFields,
    saveTaskEdit,
    deleteTaskUndoable,
    lineTaskBody,
    TASK_PRIORITIES,
} from './taskEditSave'

const originalBase = apiBase()
afterEach(() => setTransport(httpTransport(originalBase)))

let posts: { path: string; body: any }[] = []

beforeEach(() => {
    posts = []
    setTransport({
        post: async (path: string, body: unknown) => {
            posts.push({ path, body })
            return new Response('ok')
        },
        postJson: async (path: string, body: unknown) => {
            posts.push({ path, body })
            return { path: 'Inbox.md' }
        },
    } as unknown as Transport)
})

const file = { path: 'Projects/Site.md', name: 'Site' } as Row['file']
const lineRow = {
    file,
    note: {
        line: 3,
        description: 'hero',
        status: 'todo',
        statusChar: ' ',
        priority: 'high',
        due: '2026-10-01',
        raw: '- [ ] hero [high] [due 2026-10-01]',
    },
    formula: {},
} as unknown as Row
const storedRow = {
    file: { path: 'boards/t.md', name: 't' },
    index: 2,
    note: { description: 'renew', status: 'todo', category: 'Admin' },
    formula: {},
} as unknown as Row

describe('saveTaskEdit', () => {
    test('writes nothing when nothing changed', async () => {
        const f = initialTaskFields(lineRow, 'category')
        await saveTaskEdit(lineRow, f, { ...f }, { categoryField: 'category' })
        expect(posts).toEqual([])
    })
    test('a line task patches only the changed fields', async () => {
        const f = initialTaskFields(lineRow, 'category')
        await saveTaskEdit(
            lineRow,
            f,
            { ...f, description: 'hero v2', priority: null },
            { categoryField: 'category' },
        )
        expect(posts.length).toBe(1)
        expect(posts[0].path).toBe('/tasks/update')
        expect(posts[0].body.patch.description).toBe('hero v2')
        expect(posts[0].body.patch.priority).toBeNull()
        expect(posts[0].body.patch.due).toBeUndefined()
    })
    test('a status change on a line task toggles with the char', async () => {
        const f = initialTaskFields(lineRow, 'category')
        await saveTaskEdit(lineRow, f, { ...f, statusChar: 'x' }, {
            categoryField: 'category',
        })
        expect(posts[0].path).toBe('/tasks/toggle')
    })
    test('a line task moves when the destination changes', async () => {
        const f = initialTaskFields(lineRow, 'category')
        await saveTaskEdit(lineRow, f, { ...f, destPath: 'Inbox.md' }, {
            categoryField: 'category',
        })
        expect(posts.map(p => p.path)).toEqual(['/tasks/move'])
    })
    test('a stored row writes its category under the category field', async () => {
        const f = initialTaskFields(storedRow, 'category')
        await saveTaskEdit(storedRow, f, { ...f, category: 'Home' }, {
            categoryField: 'category',
        })
        expect(posts[0].path).toBe('/row/update')
        expect(posts[0].body.note.category).toBe('Home')
    })
    test('done on a recurring stored row rewrites it and appends the next', async () => {
        const rec = {
            ...storedRow,
            note: { ...storedRow.note, recurrence: 'every week', due: '2026-10-01' },
        } as unknown as Row
        const f = initialTaskFields(rec, 'category')
        await saveTaskEdit(rec, f, { ...f, statusChar: 'x' }, {
            categoryField: 'category',
        })
        expect(posts.map(p => p.path)).toEqual(['/row/update', '/row/update'])
        expect(posts[1].body.index).toBeNull()
    })
})

describe('deleteTaskUndoable', () => {
    test('a line task deletes, and undo re-creates its text', async () => {
        const undo = await deleteTaskUndoable(lineRow)
        expect(posts[0].path).toBe('/tasks/delete')
        await undo()
        expect(posts[1].path).toBe('/tasks/create')
        expect(posts[1].body.file).toBe('Projects/Site.md')
        expect(posts[1].body.body).toBe('hero [high] [due 2026-10-01]')
    })
    test('a stored row deletes, and undo re-creates the row', async () => {
        const undo = await deleteTaskUndoable(storedRow)
        expect(posts[0].path).toBe('/row/delete')
        await undo()
        expect(posts[1].path).toBe('/row/update')
        expect(posts[1].body.index).toBeNull()
        expect(posts[1].body.note.description).toBe('renew')
    })
})

test('lineTaskBody strips indent and the checkbox', () => {
    expect(lineTaskBody('  - [x] done thing')).toBe('done thing')
    expect(lineTaskBody('plain')).toBe('plain')
})

test('TASK_PRIORITIES lists the union in order', () => {
    expect(TASK_PRIORITIES).toEqual(['highest', 'high', 'medium', 'low', 'lowest'])
})
