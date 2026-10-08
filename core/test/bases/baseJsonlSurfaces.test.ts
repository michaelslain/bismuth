import { describe, expect, spyOn, test } from 'bun:test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listBases, listTree } from '../../src/files'
import { buildDenyPaths } from '../../src/visibility'
import { getFileAccess } from '../../src/fileAccess'
import { isTreeListedName } from '../../src/fileKinds'
import { resolveRefPath, resolveSource } from '../../src/bases/source'
import { refToPath } from '../../src/bases/sourceSpec'
import { listGcalSyncTargets } from '../../src/gcal/discover'
import { createServer } from '../../src/server'
import { makeVault } from '../helpers'
import { shouldRunSlowTests } from '../slowGate'

const jsonl = (config: Record<string, unknown>, rows: unknown[] = []) =>
    [config, ...rows].map(o => JSON.stringify(o)).join('\n') + '\n'

describe('file tree + listBases', () => {
    test('listBases finds nested .base.jsonl, skips dot-dirs and md', async () => {
        const vault = makeVault({
            'A.base.jsonl': jsonl({ type: 'base' }),
            'sub/B.base.jsonl': jsonl({ type: 'base' }),
            '.hidden/C.base.jsonl': jsonl({ type: 'base' }),
            'note.md': '# n\n',
        })
        expect((await listBases(vault)).sort()).toEqual([
            'A.base.jsonl',
            'sub/B.base.jsonl',
        ])
        expect((await (await getFileAccess()).listBases(vault)).length).toBe(2)
    })

    test('tree lists .base.jsonl as a file', async () => {
        const vault = makeVault({
            'A.base.jsonl': jsonl({ type: 'base' }),
            'x.json': '{}',
        })
        const paths = (await listTree(vault)).map(e => e.path)
        expect(paths).toContain('A.base.jsonl')
        expect(paths).not.toContain('x.json')
        expect(isTreeListedName('sub/A.base.jsonl')).toBe(true)
        expect(isTreeListedName('a.jsonl')).toBe(false)
    })
})

describe('ref resolution', () => {
    test('refToPath keeps a .base.jsonl ref', () => {
        expect(refToPath('[[X.base.jsonl]]')).toBe('X.base.jsonl')
        expect(refToPath('[[X]]')).toBe('X.md')
    })

    test('bare name resolves to the jsonl base', async () => {
        const vault = makeVault({ 'X.base.jsonl': jsonl({ type: 'base' }) })
        expect(await resolveRefPath(vault, '[[X]]')).toBe('X.base.jsonl')
        expect(await resolveRefPath(vault, '[[X.base.jsonl]]')).toBe(
            'X.base.jsonl',
        )
    })

    test('exact path first, jsonl before md on a tie, fewest segments wins', async () => {
        const vault = makeVault({
            'T.base.jsonl': jsonl({ type: 'base' }),
            'T.md': '---\ntype: base\n---\n',
            'deep/er/U.base.jsonl': jsonl({ type: 'base' }),
            'U.md': '---\ntype: base\n---\n',
            'a/V.md': '---\ntype: base\n---\n',
            'a/b/V.base.jsonl': jsonl({ type: 'base' }),
            'sub/W.base.jsonl': jsonl({ type: 'base' }),
        })
        expect(await resolveRefPath(vault, '[[T]]')).toBe('T.base.jsonl')
        expect(await resolveRefPath(vault, '[[T.md]]')).toBe('T.md')
        expect(await resolveRefPath(vault, '[[U]]')).toBe('U.md')
        expect(await resolveRefPath(vault, '[[V]]')).toBe('a/V.md')
        expect(await resolveRefPath(vault, '[[W]]')).toBe('sub/W.base.jsonl')
        expect(await resolveRefPath(vault, '[[nope]]')).toBe('nope.md')
    })

    test('notes from: a jsonl base selects what its markdown twin selects', async () => {
        const notes = {
            'one.md': '---\ntags: [keep]\n---\n# one\n',
            'two.md': '---\ntags: [other]\n---\n# two\n',
        }
        const twinMd =
            '---\ntype: base\nsource: notes where tags.contains("keep")\n---\n'
        const vault = makeVault({
            ...notes,
            'Keep.base.jsonl': jsonl({
                type: 'base',
                source: 'notes where tags.contains("keep")',
            }),
        })
        const vaultMd = makeVault({ ...notes, 'Keep.md': twinMd })
        const spec = { kind: 'notes' as const, from: '[[Keep]]' }
        const a = await resolveSource(spec, { root: vault })
        const b = await resolveSource(spec, { root: vaultMd })
        expect(a.map(r => r.file.path).sort()).toEqual(['one.md'])
        expect(a.map(r => r.file.path).sort()).toEqual(
            b.map(r => r.file.path).sort(),
        )
        const viaBase = await resolveSource(
            { kind: 'base', ref: '[[Keep]]' },
            { root: vault },
        )
        expect(viaBase.map(r => r.file.path)).toEqual(['one.md'])
    })
})

describe('gcal discovery', () => {
    test('finds a jsonl calendar base with sync enabled', async () => {
        const vault = makeVault({
            'Cal.base.jsonl': jsonl({
                type: 'base',
                view: 'calendar',
                googleCalendarSync: true,
                googleCalendarId: 'abc@group.calendar.google.com',
            }),
            'Off.base.jsonl': jsonl({ type: 'base', view: 'calendar' }),
            'Plain.base.jsonl': jsonl({ type: 'base', view: 'table' }),
        })
        const targets = await listGcalSyncTargets(vault)
        expect(targets.map(t => t.basePath)).toEqual(['Cal.base.jsonl'])
    })
})

const slow = shouldRunSlowTests(process.env) ? test : test.skip

type Ev = {
    version: number
    paths: string[]
    dirty?: { graph: boolean; tree: boolean }
}

function collect(base: string): { events: Ev[]; stop: () => void } {
    const events: Ev[] = []
    const ac = new AbortController()
    void (async () => {
        try {
            const res = await fetch(`${base}/events`, { signal: ac.signal })
            const reader = res.body!.getReader()
            const dec = new TextDecoder()
            let buf = ''
            for (;;) {
                const { value, done } = await reader.read()
                if (done) return
                buf += dec.decode(value)
                const frames = buf.split('\n\n')
                buf = frames.pop() ?? ''
                for (const f of frames)
                    if (f.startsWith('data: '))
                        events.push(JSON.parse(f.slice(6)))
            }
        } catch {
            // aborted
        }
    })()
    return { events, stop: () => ac.abort() }
}

describe('server watcher', () => {
    slow(
        'editing an existing base is SSE-only; create and delete dirty tree + graph',
        async () => {
            const vault = makeVault({
                'a.md': '# a\n',
                'Cal.base.jsonl': jsonl({ type: 'base' }),
            })
            const server = createServer({ vault, port: 0 })
            const base = `http://localhost:${server.port}`
            try {
                const { events, stop } = collect(base)
                try {
                    await Bun.sleep(1500)
                    events.length = 0
                    writeFileSync(
                        join(vault, 'Cal.base.jsonl'),
                        jsonl({ type: 'base' }, [{ id: 1 }]),
                    )
                    await Bun.sleep(1500)
                    const edit = events.filter(e =>
                        e.paths.includes('Cal.base.jsonl'),
                    )
                    expect(edit.length).toBeGreaterThan(0)
                    expect(
                        edit.every(e => !e.dirty?.tree && !e.dirty?.graph),
                    ).toBe(true)

                    events.length = 0
                    writeFileSync(
                        join(vault, 'Cal.base.jsonl'),
                        jsonl({ type: 'base', icon: 'star' }, [{ id: 1 }]),
                    )
                    await Bun.sleep(1500)
                    const iconEdit = events.filter(e =>
                        e.paths.includes('Cal.base.jsonl'),
                    )
                    expect(iconEdit.some(e => e.dirty?.tree)).toBe(true)
                    expect(iconEdit.every(e => !e.dirty?.graph)).toBe(true)

                    events.length = 0
                    writeFileSync(
                        join(vault, 'New.base.jsonl'),
                        jsonl({ type: 'base' }),
                    )
                    await Bun.sleep(1500)
                    const create = events.filter(e =>
                        e.paths.includes('New.base.jsonl'),
                    )
                    expect(
                        create.some(e => e.dirty?.tree && e.dirty?.graph),
                    ).toBe(true)

                    events.length = 0
                    rmSync(join(vault, 'New.base.jsonl'))
                    await Bun.sleep(1500)
                    const del = events.filter(e =>
                        e.paths.includes('New.base.jsonl'),
                    )
                    expect(del.some(e => e.dirty?.tree && e.dirty?.graph)).toBe(
                        true,
                    )

                    // created post-boot: a row-only edit is SSE-only
                    writeFileSync(
                        join(vault, 'New.base.jsonl'),
                        jsonl({ type: 'base' }),
                    )
                    await Bun.sleep(1500)
                    events.length = 0
                    writeFileSync(
                        join(vault, 'New.base.jsonl'),
                        jsonl({ type: 'base' }, [{ id: 1 }]),
                    )
                    await Bun.sleep(1500)
                    const rowEdit = events.filter(e =>
                        e.paths.includes('New.base.jsonl'),
                    )
                    expect(rowEdit.length).toBeGreaterThan(0)
                    expect(
                        rowEdit.every(e => !e.dirty?.tree && !e.dirty?.graph),
                    ).toBe(true)

                    // delete + recreate: a later line-1 icon change still dirties the tree
                    rmSync(join(vault, 'New.base.jsonl'))
                    await Bun.sleep(1500)
                    writeFileSync(
                        join(vault, 'New.base.jsonl'),
                        jsonl({ type: 'base' }),
                    )
                    await Bun.sleep(1500)
                    events.length = 0
                    writeFileSync(
                        join(vault, 'New.base.jsonl'),
                        jsonl({ type: 'base', icon: 'star' }),
                    )
                    await Bun.sleep(1500)
                    const reIcon = events.filter(e =>
                        e.paths.includes('New.base.jsonl'),
                    )
                    expect(reIcon.some(e => e.dirty?.tree)).toBe(true)
                } finally {
                    stop()
                }
            } finally {
                server.stop(true)
            }
        },
        30_000,
    )
})

describe('jsonl base visibility + icon', () => {
    test('line-1 visibility hidden lands in the deny list', async () => {
        const vault = makeVault({
            'Secret.base.jsonl': jsonl({ type: 'base', visibility: 'hidden' }),
            'Open.base.jsonl': jsonl({ type: 'base' }),
            'Secret2.md': '---\nvisibility: hidden\n---\nx\n',
        })
        const denied = (await buildDenyPaths(vault, 'daemon')).map(e => e.rel)
        expect(denied).toContain('Secret.base.jsonl')
        expect(denied).toContain('Secret2.md')
        expect(denied).not.toContain('Open.base.jsonl')
    })

    test('garbage line 1 fails closed', async () => {
        const vault = makeVault({
            'Bad.base.jsonl': '{"type":"base","visibility":\nrow\n',
        })
        const denied = (await buildDenyPaths(vault, 'daemon')).map(e => e.rel)
        expect(denied).toContain('Bad.base.jsonl')
    })

    test('typeless line 1 still carries visibility', async () => {
        const vault = makeVault({
            'T.base.jsonl': jsonl({ visibility: 'chat-only' }),
        })
        const denied = (await buildDenyPaths(vault, 'daemon')).map(e => e.rel)
        expect(denied).toContain('T.base.jsonl')
    })

    test('over 512 bytes of leading whitespace does not read as visible', async () => {
        const vault = makeVault({
            'W.base.jsonl':
                ' '.repeat(2000) +
                jsonl({ type: 'base', visibility: 'hidden' }),
        })
        const denied = (await buildDenyPaths(vault, 'daemon')).map(e => e.rel)
        expect(denied).toContain('W.base.jsonl')
    })

    test('listTree reports visibility + icon for a jsonl base', async () => {
        const vault = makeVault({
            'B.base.jsonl': jsonl({
                type: 'base',
                visibility: 'hidden',
                icon: 'Star',
            }),
        })
        const e = (await listTree(vault)).find(x => x.path === 'B.base.jsonl')
        expect(e?.visibility).toBe('hidden')
        expect(e?.icon).toBe('Star')
    })
})

describe('ref resolution fast path', () => {
    test('exact hits do not list the vault', async () => {
        const vault = makeVault({
            'X.base.jsonl': jsonl({ type: 'base' }),
            'deep/X.base.jsonl': jsonl({ type: 'base' }),
            'N.md': '---\ntype: base\n---\n',
        })
        const fa = await getFileAccess()
        const lists = spyOn(fa, 'listMarkdown')
        const bases = spyOn(fa, 'listBases')
        expect(await resolveRefPath(vault, '[[X]]')).toBe('X.base.jsonl')
        expect(await resolveRefPath(vault, '[[N]]')).toBe('N.md')
        expect(lists).not.toHaveBeenCalled()
        expect(bases).not.toHaveBeenCalled()
        // a miss still resolves by basename through the listings
        expect(await resolveRefPath(vault, '[[deep/X]]')).toBe(
            'deep/X.base.jsonl',
        )
        lists.mockRestore()
        bases.mockRestore()
    })
})
