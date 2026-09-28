import { afterEach, expect, test } from 'bun:test'
import type { Row } from '../../../core/src/bases/types'
import { placeholderFile } from '../../../core/src/bases/types'
import { apiBase, httpTransport, setTransport, type Transport } from '../api'
import { commitDelete, safeFilename } from './rowWrites'

const originalBase = apiBase()
afterEach(() => setTransport(httpTransport(originalBase)))

type Call = { verb: string; path: string; body: unknown }

/** A Transport that records every write and answers `/delete` with a trash path. */
function install(calls: Call[]): void {
    const ok = () => Promise.resolve(new Response('{}'))
    const stub: Transport = {
        getJson: () => Promise.reject(new Error('not stubbed')),
        getText: () => Promise.reject(new Error('not stubbed')),
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
    await undo()
    expect(calls[1]).toEqual({
        verb: 'post',
        path: '/restore',
        body: { trashPath: '.trash/a.md', to: 'notes/a.md' },
    })
    expect(changed).toBe(2)
})

test('commitDelete of a stored row deletes by index and its undo re-creates the row', async () => {
    const calls: Call[] = []
    install(calls)
    const stored: Row = {
        file: placeholderFile('', 'tasks.md'),
        note: { title: 'x' },
        formula: {},
        index: 2,
    }
    const undo = await commitDelete(stored)
    expect(calls[0]).toEqual({ verb: 'post', path: '/row/delete', body: { file: 'tasks.md', index: 2 } })
    await undo()
    expect(calls[1]).toEqual({
        verb: 'post',
        path: '/row/update',
        body: { file: 'tasks.md', index: null, note: { title: 'x' } },
    })
})
