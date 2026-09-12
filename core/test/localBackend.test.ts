// core/test/localBackend.test.ts
// Proves the in-process backend (the iPad "server") works end-to-end against a
// purely in-memory FileAccess — no HTTP, no Bun, no disk. This is the mobile path.
import { test, expect, describe, afterEach } from 'bun:test'
import { createLocalBackend } from '../src/localBackend'
import { setFileAccess, type FileAccess } from '../src/fileAccess'
import type { GraphData } from '../src/graph'
import type { Task } from '../src/tasks'

// An in-memory vault standing in for tauri-plugin-fs. writeNote mutates the map so
// reads reflect writes (the real device behavior).
function memVault(initial: Record<string, string>): {
    fa: FileAccess
    files: Record<string, string>
} {
    const files = { ...initial }
    const fa: FileAccess = {
        listMarkdown: async () =>
            Object.keys(files).filter(p => p.endsWith('.md')),
        listTree: async () =>
            Object.keys(files).map(path => ({ path, kind: 'file' as const })),
        readNote: async (_root, rel) => {
            if (!(rel in files)) throw new Error(`ENOENT ${rel}`)
            return files[rel]
        },
        writeNote: async (_root, rel, contents) => {
            files[rel] = contents
        },
        statNote: async (_root, rel) =>
            rel in files
                ? {
                      size: files[rel].length,
                      mtimeMs: 0,
                      ctimeMs: 0,
                      birthtimeMs: 0,
                  }
                : null,
        realPath: async p => p,
    }
    return { fa, files }
}

afterEach(() => setFileAccess(undefined as unknown as FileAccess))

describe('localBackend dispatch (no HTTP / no Bun)', () => {
    test('builds the graph from an in-memory vault', async () => {
        const { fa } = memVault({ 'a.md': 'see [[b]]', 'b.md': 'leaf' })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        const g = (await be.dispatch('GET', '/graph')) as GraphData
        expect(g.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
        // a → b wikilink edge resolved
        expect(g.edges.some(e => e.from === 'a' && e.to === 'b')).toBe(true)
    })

    test('reads file + frontmatter meta', async () => {
        const { fa } = memVault({ 'n.md': '---\ntitle: Hi\n---\nbody' })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        expect(await be.dispatch('GET', '/file?path=n.md')).toBe(
            '---\ntitle: Hi\n---\nbody',
        )
        expect(await be.dispatch('GET', '/meta?path=n.md')).toEqual({
            title: 'Hi',
        })
    })

    test('PUT /file writes through + bumps version + notifies subscribers', async () => {
        const { fa, files } = memVault({ 'n.md': 'old' })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        const events: Array<{ version: number; paths: string[] }> = []
        be.subscribe(e => events.push(e))

        expect(be.getVersion()).toBe(0)
        await be.dispatch('PUT', '/file', { path: 'n.md', contents: 'new' })
        expect(files['n.md']).toBe('new') // wrote through to the (in-memory) vault
        expect(be.getVersion()).toBe(1)
        expect(events).toEqual([{ version: 1, paths: ['n.md'] }])
    })

    test('set-property edits frontmatter; refuses a nonexistent note', async () => {
        const { fa, files } = memVault({ 'n.md': '---\na: 1\n---\nx' })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await be.dispatch('POST', '/set-property', {
            path: 'n.md',
            key: 'b',
            value: 2,
        })
        expect(files['n.md']).toContain('b: 2')
        // missing note → 404, not a silent create
        await expect(
            be.dispatch('POST', '/set-property', {
                path: 'missing.md',
                key: 'b',
                value: 2,
            }),
        ).rejects.toThrow()
    })

    test('collects tasks from the vault', async () => {
        const { fa } = memVault({ 'todo.md': '- [ ] one\n- [x] two' })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        const tasks = (await be.dispatch('GET', '/tasks')) as Task[]
        expect(tasks.length).toBe(2)
        expect(tasks.map(t => t.statusChar).sort()).toEqual([' ', 'x'])
    })

    test('search returns ranked hits', async () => {
        const { fa } = memVault({
            'a.md': 'the quick brown fox',
            'b.md': 'nothing here',
        })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        const hits = (await be.dispatch('POST', '/search', {
            query: 'fox',
            opts: { caseSensitive: false, wholeWord: false, regex: false },
        })) as Array<{ path: string }>
        expect(hits.some(h => h.path === 'a.md')).toBe(true)
    })

    // The same missing-index data loss the HTTP routes carried, on the transport that is
    // the ONLY write path on iPad. `JSON.stringify` is not involved here — the caller passes
    // an object — but an object built from a row with no `Row.index` has the same shape: the
    // key is simply absent. Update then computed `index ?? null` and APPENDED a duplicate of
    // the row being edited; delete fell through `index < 0 || index >= rows.length` (every
    // comparison with NaN is false) into `splice(undefined, 1)` → `splice(0, 1)` and removed
    // the FIRST row whichever one the user meant.
    const BASE_ONE_ROW =
        '---\ntype: base\nview: table\n---\n\n| id | title |\n| --- | --- |\n| 1 | A |'
    const BASE_TWO_ROWS = `${BASE_ONE_ROW}\n| 2 | B |`

    test('row/update with a missing index is refused, not turned into an append', async () => {
        const { fa, files } = memVault({ 'Cal.md': BASE_ONE_ROW })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/row/update', {
                file: 'Cal.md',
                note: { id: 1, title: 'Z' },
            }),
        ).rejects.toThrow(/index/i)
        // nothing written: the file is byte-identical and still holds exactly one row
        expect(files['Cal.md']).toBe(BASE_ONE_ROW)
    })

    test('row/update with an explicit null index still appends', async () => {
        const { fa, files } = memVault({ 'Cal.md': BASE_ONE_ROW })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await be.dispatch('POST', '/row/update', {
            file: 'Cal.md',
            index: null,
            note: { id: 2, title: 'B' },
        })
        expect(files['Cal.md']).toContain('title: B')
    })

    test('row/delete with a missing index is refused, not applied to row 0', async () => {
        const { fa, files } = memVault({ 'Cal.md': BASE_TWO_ROWS })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/row/delete', { file: 'Cal.md' }),
        ).rejects.toThrow(/index/i)
        expect(files['Cal.md']).toBe(BASE_TWO_ROWS)
    })

    test('row/update rejects a non-integer NUMBER, not just a missing key', async () => {
        // `typeof index !== 'number'` alone catches an omitted key and a string by accident,
        // so dropping the Number.isInteger half left every test green. The message is what
        // pins WHICH layer refused: upsertRow's own range check would also reject 2.5, but it
        // says "out of range" — and 2.5 is not out of range, it is not an index at all.
        const { fa, files } = memVault({ 'Cal.md': BASE_ONE_ROW })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/row/update', {
                file: 'Cal.md',
                index: 2.5,
                note: { id: 1, title: 'Z' },
            }),
        ).rejects.toThrow(/must be an integer/)
        expect(files['Cal.md']).toBe(BASE_ONE_ROW)
    })

    test('row/delete removes the row the caller named, and only that one', async () => {
        const three = `${BASE_TWO_ROWS}\n| 3 | C |`
        const { fa, files } = memVault({ 'Cal.md': three })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await be.dispatch('POST', '/row/delete', { file: 'Cal.md', index: 1 })
        // the MIDDLE row went — a splice(0, 1) bug would have passed a "row was deleted" test
        expect(files['Cal.md']).toContain('id: 1')
        expect(files['Cal.md']).not.toContain('id: 2')
        expect(files['Cal.md']).toContain('id: 3')
    })

    test('row/delete rejects a non-integer NUMBER, not just a missing key', async () => {
        // NaN survives this transport (no JSON round trip), and every comparison with it is
        // false — so the range check alone would let it through to splice(0, 1)
        const { fa, files } = memVault({ 'Cal.md': BASE_TWO_ROWS })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/row/delete', { file: 'Cal.md', index: NaN }),
        ).rejects.toThrow(/index/i)
        expect(files['Cal.md']).toBe(BASE_TWO_ROWS)
    })

    test('row/reorder rejects a missing index instead of moving row 0', async () => {
        const { fa, files } = memVault({ 'Cal.md': BASE_TWO_ROWS })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/row/reorder', { file: 'Cal.md', to: 1 }),
        ).rejects.toThrow(/out of range/)
        expect(files['Cal.md']).toBe(BASE_TWO_ROWS)
    })

    test('rows/update applies a batch and rejects a MIXED batch whole, without writing', async () => {
        const { fa, files } = memVault({ 'Cal.md': BASE_TWO_ROWS })
        setFileAccess(fa)
        const be = createLocalBackend({ vault: '/v' })
        await be.dispatch('POST', '/rows/update', {
            file: 'Cal.md',
            updates: [
                { index: 0, note: { id: 1, title: 'a2' } },
                { index: null, note: { id: 3, title: 'c' } },
            ],
        })
        expect(files['Cal.md']).toContain('a2')
        expect(files['Cal.md']).toContain('c')
        const afterFirstBatch = files['Cal.md']
        // A batch mixing one VALID write with one bad index — a wholly-bad batch alone
        // cannot prove atomicity, because it would also throw under a partial-apply bug.
        // This one would NOT throw under that bug: `rows[99] = row` on this 2-row array
        // grows it to length 100 via JS's sparse-array assignment, so a range check
        // performed AFTER that mutation sees the already-widened length and lets it
        // through — and the valid write alongside it would have already landed on disk.
        await expect(
            be.dispatch('POST', '/rows/update', {
                file: 'Cal.md',
                updates: [
                    { index: 0, note: { id: 1, title: 'should not land' } },
                    { index: 99, note: {} },
                ],
            }),
        ).rejects.toThrow()
        expect(files['Cal.md']).toBe(afterFirstBatch)
    })

    test('structural ops report NOT_SUPPORTED (documented follow-up)', async () => {
        setFileAccess(memVault({}).fa)
        const be = createLocalBackend({ vault: '/v' })
        await expect(
            be.dispatch('POST', '/create', { path: 'x.md', kind: 'file' }),
        ).rejects.toThrow(/not supported/i)
    })
})
