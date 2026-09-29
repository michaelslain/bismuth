import { expect, test, describe, beforeEach, afterEach } from 'bun:test'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { removeTaskItem } from '../../../core/src/taskEdit'
import { parseBaseFile } from '../../../core/src/bases/parse'
import {
    upsertRow,
    deleteRow,
    reorderRow,
} from '../../../core/src/bases/rowOps'
import type { Row } from '../../../core/src/bases/types'
import {
    initialTaskFields,
    saveTaskEdit,
    deleteTaskUndoable,
    reinsertTaskBlock,
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
        await saveTaskEdit(
            lineRow,
            f,
            { ...f, statusChar: 'x' },
            {
                categoryField: 'category',
            },
        )
        expect(posts[0].path).toBe('/tasks/toggle')
    })
    test('a line task moves when the destination changes', async () => {
        const f = initialTaskFields(lineRow, 'category')
        await saveTaskEdit(
            lineRow,
            f,
            { ...f, destPath: 'Inbox.md' },
            {
                categoryField: 'category',
            },
        )
        expect(posts.map(p => p.path)).toEqual(['/tasks/move'])
    })
    test('a stored row writes its category under the category field', async () => {
        const f = initialTaskFields(storedRow, 'category')
        await saveTaskEdit(
            storedRow,
            f,
            { ...f, category: 'Home' },
            {
                categoryField: 'category',
            },
        )
        expect(posts[0].path).toBe('/row/update')
        expect(posts[0].body.note.category).toBe('Home')
    })
    test('a stored row keeps the new status when another field changes too', async () => {
        const f = initialTaskFields(storedRow, 'category')
        await saveTaskEdit(
            storedRow,
            f,
            { ...f, statusChar: 'x', description: 'renew v2' },
            { categoryField: 'category' },
        )
        const updates = posts.filter(p => p.path === '/row/update')
        const last = updates[updates.length - 1]
        expect(last.body.note.status).toBe('done')
        expect(last.body.note.description).toBe('renew v2')
    })
    test('done on a recurring stored row rewrites it and appends the next', async () => {
        const rec = {
            ...storedRow,
            note: {
                ...storedRow.note,
                recurrence: 'every week',
                due: '2026-10-01',
            },
        } as unknown as Row
        const f = initialTaskFields(rec, 'category')
        await saveTaskEdit(
            rec,
            f,
            { ...f, statusChar: 'x' },
            {
                categoryField: 'category',
            },
        )
        expect(posts.map(p => p.path)).toEqual(['/row/update', '/row/update'])
        expect(posts[1].body.index).toBeNull()
    })
})

describe('deleteTaskUndoable', () => {
    // A stateful fake vault: one text per path; the task + row routes edit it with the real core ops.
    let files: Record<string, string>
    beforeEach(() => {
        files = {}
        const handle = (path: string, body: any) => {
            if (path === '/tasks/delete')
                files[body.path] = removeTaskItem(
                    files[body.path],
                    body.line,
                ).content
            if (path === '/row/delete')
                files[body.file] = deleteRow(
                    files[body.file],
                    baseMeta,
                    body.index,
                )
            if (path === '/row/update')
                files[body.file] = upsertRow(
                    files[body.file],
                    baseMeta,
                    body.index,
                    body.note,
                )
            if (path === '/row/reorder')
                files[body.file] = reorderRow(
                    files[body.file],
                    baseMeta,
                    body.from,
                    body.to,
                )
        }
        setTransport({
            post: async (path: string, body: unknown) => {
                handle(path, body)
                return new Response('ok')
            },
            postJson: async () => ({}),
            getText: async (path: string) =>
                files[decodeURIComponent(path.split('path=')[1])],
            put: async (_p: string, body: any) => {
                files[body.path] = body.contents
                return new Response('ok')
            },
        } as unknown as Transport)
    })
    const baseMeta = { name: 't', path: 'boards/t.md' }
    const noteText = [
        '# Plan',
        '',
        '- [ ] first',
        '- [/] middle [high] [due 2026-10-01]',
        '    - [x] sub one',
        '    - [ ] sub two [low]',
        '- [ ] last',
        '',
        'tail',
        '',
    ].join('\n')
    const at = (line: number) =>
        ({ file, note: { line }, formula: {} }) as unknown as Row

    test('a line task with two sub-tasks deletes and undoes byte-identically', async () => {
        files[file.path] = noteText
        const undo = await deleteTaskUndoable(at(3))
        expect(files[file.path]).not.toContain('middle')
        expect(files[file.path]).toContain('- [ ] last')
        await undo()
        expect(files[file.path]).toBe(noteText)
    })
    test('a doing [/] task keeps its status through undo', async () => {
        files[file.path] = noteText
        const undo = await deleteTaskUndoable(at(3))
        await undo()
        expect(files[file.path]).toContain(
            '- [/] middle [high] [due 2026-10-01]',
        )
    })
    test('undo clamps the index when the note has shrunk', async () => {
        files[file.path] = noteText
        const undo = await deleteTaskUndoable(at(6))
        files[file.path] = '# Plan\n'
        await undo()
        expect(files[file.path]).toBe('# Plan\n- [ ] last\n')
    })
    test('a stored row returns at its original index', async () => {
        const rows = (t: string) =>
            parseBaseFile(t, baseMeta).rows.map(r => r.note.name)
        files[baseMeta.path] =
            '---\ncolumns: [name]\n---\n- name: a\n- name: b\n- name: c\n'
        const row = {
            file: { path: baseMeta.path, name: 't' },
            index: 1,
            note: { name: 'b' },
            formula: {},
        } as unknown as Row
        const undo = await deleteTaskUndoable(row)
        expect(rows(files[baseMeta.path])).toEqual(['a', 'c'])
        await undo()
        expect(rows(files[baseMeta.path])).toEqual(['a', 'b', 'c'])
    })
})

test('reinsertTaskBlock puts a block back at an index', () => {
    expect(reinsertTaskBlock('a\nc\n', ['b'], 1)).toBe('a\nb\nc\n')
})

describe('reinsertTaskBlock anchor', () => {
    test('an edit above the task shifts lines down: block returns next to the anchor', () => {
        expect(reinsertTaskBlock('new\nh\na\nc\n', ['b'], 2, 'a')).toBe(
            'new\nh\na\nb\nc\n',
        )
    })
    test('an edit below the task (no shift) still returns it at the index', () => {
        expect(reinsertTaskBlock('a\nc\nmore\n', ['b'], 1, 'a')).toBe(
            'a\nb\nc\nmore\n',
        )
    })
    test('a duplicated anchor falls back to the index', () => {
        expect(reinsertTaskBlock('x\na\ny\na\nc\n', ['b'], 1, 'a')).toBe(
            'x\nb\na\ny\na\nc\n',
        )
    })
    test('no anchor (index 0) inserts at the index', () => {
        expect(reinsertTaskBlock('c\n', ['b'], 0, undefined)).toBe('b\nc\n')
    })
})

test('TASK_PRIORITIES lists the union in order', () => {
    expect(TASK_PRIORITIES).toEqual([
        'highest',
        'high',
        'medium',
        'low',
        'lowest',
    ])
})
