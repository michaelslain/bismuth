import { describe, test, expect, afterAll, afterEach, spyOn } from 'bun:test'
import { utimesSync } from 'node:fs'
import { join } from 'node:path'
import * as graph from '../src/graph.ts'
import { loadAllNotes, writeNote, deleteNote } from '../src/graph.ts'
import type { NoteFrontmatter } from '../src/graph.ts'
import { clearNoteCache, loadAllNotesCached } from '../src/noteCache.ts'
import { sweepTempDirs, tempDir } from './tempDirs.ts'

afterAll(sweepTempDirs)
afterEach(() => clearNoteCache())

const fm: NoteFrontmatter = {
    type: 'fact',
    tags: [],
    created: '2026-01-01',
    updated: '2026-01-01',
}

const sameAsUncached = async (dir: string) => {
    const norm = (ns: graph.MemoryNote[]) =>
        [...ns].sort((a, b) => a.name.localeCompare(b.name))
    expect(norm(await loadAllNotesCached(dir))).toEqual(
        norm(await loadAllNotes(dir)),
    )
}

describe('loadAllNotesCached', () => {
    test('unchanged files are not re-read', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('a', fm, 'alpha', dir)
        await writeNote('b', fm, 'beta', dir)
        await loadAllNotesCached(dir)
        const spy = spyOn(graph, 'readNote')
        await loadAllNotesCached(dir)
        const calls = spy.mock.calls.length
        spy.mockRestore()
        expect(calls).toBe(0)
        await sameAsUncached(dir)
    })

    test('an edited note is re-read', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('a', fm, 'alpha', dir)
        await loadAllNotesCached(dir)
        await writeNote('a', fm, 'alpha edited longer', dir)
        const notes = await loadAllNotesCached(dir)
        expect(notes[0]!.content).toBe('alpha edited longer')
        await sameAsUncached(dir)
    })

    test('a same-size edit with a new mtime is re-read', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('a', fm, 'aaaa', dir)
        await loadAllNotesCached(dir)
        await writeNote('a', fm, 'bbbb', dir)
        const t = new Date(Date.now() + 5000)
        utimesSync(join(dir, 'a.md'), t, t)
        expect((await loadAllNotesCached(dir))[0]!.content).toBe('bbbb')
        await sameAsUncached(dir)
    })

    test('a deleted note disappears', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('a', fm, 'alpha', dir)
        await writeNote('b', fm, 'beta', dir)
        await loadAllNotesCached(dir)
        await deleteNote('a', dir)
        expect((await loadAllNotesCached(dir)).map(n => n.name)).toEqual(['b'])
        await sameAsUncached(dir)
    })

    test('a new note linking [[x]] shows in its backlinks and matches uncached', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('x', fm, 'target', dir)
        await loadAllNotesCached(dir)
        await writeNote('y', fm, 'see [[x]]', dir)
        const notes = await loadAllNotesCached(dir)
        expect(notes.find(n => n.name === 'y')!.backlinks).toEqual(['x'])
        expect(await graph.findBacklinks('x', dir)).toEqual(['y'])
        await sameAsUncached(dir)
    })

    test('folders are handled and clearNoteCache(dir) forces a re-read', async () => {
        const dir = tempDir('note-cache-')
        await writeNote('f', fm, 'in folder', dir, 'sub')
        await sameAsUncached(dir)
        clearNoteCache(dir)
        const spy = spyOn(graph, 'readNote')
        await loadAllNotesCached(dir)
        const calls = spy.mock.calls.length
        spy.mockRestore()
        expect(calls).toBe(1)
    })
})
