import { afterEach, expect, test } from 'bun:test'
import type { Row } from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { toasts } from '../ui/toastStore'
import { commitDelete, createRow, safeFilename } from './rowWrites'

const originalBase = apiBase()
afterEach(() => setTransport(httpTransport(originalBase)))

type Call = { verb: string; path: string; body: unknown }

/** A Transport that records every write and answers `/delete` with a trash path. */
let baseText = ''

function install(calls: Call[]): void {
    const ok = () => Promise.resolve(new Response('{}'))
    const stub: Transport = {
        getJson: () => Promise.reject(new Error('not stubbed')),
        getText: () => Promise.resolve(baseText),
        post: (path, body) => {
            calls.push({ verb: 'post', path, body })
            return ok()
        },
        put: () => Promise.reject(new Error('not stubbed')),
        postJson: <T>(path: string, body: unknown) => {
            calls.push({ verb: 'postJson', path, body })
            return Promise.resolve({ trashPath: '.trash/a.md' } as T)
        },
        writeFileChecked: () => Promise.reject(new Error('not stubbed')),
        uploadAsset: () => Promise.reject(new Error('not stubbed')),
        fetchAsset: () => Promise.reject(new Error('not stubbed')),
        convertHeic: () => Promise.reject(new Error('not stubbed')),
        stageTmpFile: () => Promise.reject(new Error('not stubbed')),
        assetUrl: (t: string) => t,
        eventsUrl: () => '',
        base: () => originalBase,
    }
    setTransport(stub)
}

const noteRow: Row = {
    file: placeholderFile('a', 'notes/a.md'),
    note: { title: 'a' },
    formula: {},
}

test('safeFilename replaces reserved characters and never returns empty', () => {
    expect(safeFilename('a/b:c*d?e"f<g>h|i#j[k]l')).toBe('a-b-c-d-e-f-g-h-i-j-k-l')
    expect(safeFilename('  two   spaces ')).toBe('two spaces')
    expect(safeFilename('...hidden')).toBe('hidden')
    expect(safeFilename('///')).toBe('---')
    expect(safeFilename('...')).toBe('Untitled')
    expect(safeFilename('x'.repeat(300))).toHaveLength(120)
})

test('commitDelete of a note row trashes it and returns an undo that restores it', async () => {
    const calls: Call[] = []
    install(calls)
    let changed = 0
    const undo = await commitDelete(noteRow, () => void changed++)
    expect(calls).toEqual([{ verb: 'postJson', path: '/delete', body: { path: 'notes/a.md' } }])
    expect(changed).toBe(1)
    expect(toasts().at(-1)!.message).toBe('deleted a')
    await undo()
    expect(calls[1]).toEqual({
        verb: 'post',
        path: '/restore',
        body: { trashPath: '.trash/a.md', to: 'notes/a.md' },
    })
    expect(changed).toBe(2)
})

test('commitDelete of a stored row deletes by index and its undo re-creates the row at its old position', async () => {
    const calls: Call[] = []
    install(calls)
    baseText = '---\ntype: base\n---\n\n| title |\n| --- |\n| a |\n| b |\n| c |\n'
    const stored: Row = {
        file: placeholderFile('', 'tasks.md'),
        note: { title: 'x' },
        formula: {},
        index: 1,
    }
    const undo = await commitDelete(stored)
    expect(calls[0]).toEqual({ verb: 'post', path: '/row/delete', body: { file: 'tasks.md', index: 1 } })
    expect(toasts().at(-1)!.message).toBe('deleted row')
    await undo()
    expect(calls[1]).toEqual({
        verb: 'post',
        path: '/row/update',
        body: { file: 'tasks.md', index: null, note: { title: 'x' } },
    })
    expect(calls[2]).toEqual({
        verb: 'post',
        path: '/row/reorder',
        body: { file: 'tasks.md', from: 3, to: 1 },
    })
})

test('commitDelete of a stored row names it in the toast when given a title', async () => {
    install([])
    baseText = '---\ntype: base\n---\n\n| title |\n| --- |\n| a |\n| b |\n| c |\n'
    const stored: Row = {
        file: placeholderFile('', 'tasks.md'),
        note: { title: 'x' },
        formula: {},
        index: 1,
    }
    await commitDelete(stored, undefined, 'x')
    expect(toasts().at(-1)!.message).toBe('deleted x')
})

const sourced = { sources: [{ path: 'x' }] } as never

test('createRow of a sourced base at the root targets a folder named after it, for .md and .base.jsonl', async () => {
    for (const basePath of ['Board.md', 'Board.base.jsonl']) {
        const writes: string[] = []
        install([])
        const t = (await import('../api')).api
        const orig = t.writeChecked
        t.writeChecked = (async (p: string) => {
            writes.push(p)
            return { conflict: false }
        }) as never
        try {
            await createRow({ config: {} as never, basePath, ownsRows: false })
        } finally {
            t.writeChecked = orig
        }
        expect(writes).toEqual(['Board/Untitled.md'])
    }
})

test('createRow of a nested sourced base lands in its own directory, for both forms', async () => {
    for (const basePath of ['boards/Board.md', 'boards/Board.base.jsonl']) {
        const writes: string[] = []
        install([])
        const t = (await import('../api')).api
        const orig = t.writeChecked
        t.writeChecked = (async (p: string) => {
            writes.push(p)
            return { conflict: false }
        }) as never
        try {
            await createRow({ config: {} as never, basePath, ownsRows: false })
        } finally {
            t.writeChecked = orig
        }
        expect(writes).toEqual(['boards/Untitled.md'])
    }
})
