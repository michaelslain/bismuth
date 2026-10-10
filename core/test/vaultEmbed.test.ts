import { test, expect, afterAll, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import {
    configureVaultEmbed,
    isSemanticUnavailable,
    syncVaultEmbeddings,
    vaultSemanticNeighbours,
    vaultSemanticSearch,
} from '../src/vaultEmbed'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => configureVaultEmbed())

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fake model: a 3-d one-hot by topic word. Deterministic, unit length.
const vecOf = (t: string) => (t.includes('beta') ? [0, 1, 0] : t.includes('gamma') ? [0, 0, 1] : [1, 0, 0])

function fixture(opts: { enabled?: boolean; slowEmbed?: boolean } = {}) {
    const vault = tempDir('vault-')
    const vectors = tempDir('vv-')
    const calls = { embed: 0, texts: [] as string[] }
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), body)
    }
    if (opts.enabled !== false) put('.settings', 'embeddings:\n  enabled: true\n')
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.embed++
            calls.texts.push(...texts)
            if (opts.slowEmbed) await sleep(200)
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    configureVaultEmbed({ channel, vectorsDir: vectors, syncDebounceMs: 10, storeDebounceMs: 10 })
    return { vault, vectors, calls, put, channel }
}

/** Search until the background pass has embedded something. */
async function settled(f: () => ReturnType<typeof vaultSemanticSearch>) {
    for (let i = 0; i < 60; i++) {
        const r = await f()
        if (!isSemanticUnavailable(r)) return r
        await sleep(100)
    }
    throw new Error('never settled')
}

test('switch off: unavailable "off" naming embeddings.enabled, and zero embed calls', async () => {
    const f = fixture({ enabled: false })
    f.put('a.md', '# a\nbeta text')
    const r = await vaultSemanticSearch(f.vault, 'beta')
    expect(isSemanticUnavailable(r) && r.unavailable).toBe('off')
    expect(isSemanticUnavailable(r) && r.message).toContain('embeddings.enabled')
    syncVaultEmbeddings(f.vault)
    expect(await vaultSemanticNeighbours(f.vault, 'a.md')).toMatchObject({ unavailable: 'off' })
    await sleep(100)
    expect(f.calls.embed).toBe(0)
})

test('a binary that cannot host the worker answers no-worker', async () => {
    const f = fixture()
    const channel = createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' })
    configureVaultEmbed({ channel, vectorsDir: f.vectors })
    expect(await vaultSemanticSearch(f.vault, 'beta')).toMatchObject({ unavailable: 'no-worker' })
})

test('ranking: the note sharing the query vector ranks first, with a bounded excerpt', async () => {
    const f = fixture()
    f.put('a.md', '# alpha note\nplain alpha words')
    f.put('b.md', '# beta note\n' + 'beta words '.repeat(100))
    f.put('sub/c.md', '# gamma note\ngamma words')
    const r = await settled(() => vaultSemanticSearch(f.vault, 'beta please', { waitMs: 2000 }))
    expect(r[0]!.path).toBe('b.md')
    expect(r[0]!.score).toBeCloseTo(1)
    expect(r[0]!.excerpt.length).toBeLessThanOrEqual(300)
    expect(r.map(h => h.path).sort()).toEqual(['a.md', 'b.md', 'sub/c.md'])
})

test('chunks lead with path, title and tags; .daemon and dot dirs are not indexed', async () => {
    const f = fixture()
    f.put('notes/x.md', '---\ntags: [zeta]\n---\n# The X title\nbody beta')
    f.put('.daemon/memory/m.md', 'beta secret')
    f.put('.hidden/h.md', 'beta hidden')
    const r = await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    expect(r.map(h => h.path)).toEqual(['notes/x.md'])
    const doc = f.calls.texts.find(t => t.includes('body beta'))!
    expect(doc.startsWith('notes/x.md\nThe X title\nzeta\n')).toBe(true)
})

test('deny filters before k: a hidden best match never appears and k visible hits return', async () => {
    const f = fixture()
    f.put('private/best.md', 'beta beta beta')
    for (const n of ['a', 'b', 'c']) f.put(`${n}.md`, `alpha ${n}`)
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const deny = [{ rel: 'private/best.md', abs: join(f.vault, 'private/best.md') }]
    const r = (await vaultSemanticSearch(f.vault, 'beta', { k: 2, deny, waitMs: 2000 })) as { path: string }[]
    expect(r.length).toBe(2)
    expect(r.some(h => h.path === 'private/best.md')).toBe(false)
    const open = (await vaultSemanticSearch(f.vault, 'beta', { k: 2, waitMs: 2000 })) as { path: string }[]
    expect(open[0]!.path).toBe('private/best.md')
})

test('neighbours exclude the note itself; an unknown note is []', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'beta two')
    f.put('c.md', 'alpha three')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const n = (await vaultSemanticNeighbours(f.vault, 'a.md', { k: 5 })) as { path: string }[]
    expect(n.map(h => h.path)).toEqual(['b.md', 'c.md'])
    expect(await vaultSemanticNeighbours(f.vault, 'nope.md')).toEqual([])
})

test('neighbours of a denied anchor note are []', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'beta two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    const deny = [{ rel: 'a.md', abs: join(f.vault, 'a.md') }]
    expect(await vaultSemanticNeighbours(f.vault, 'a.md', { deny })).toEqual([])
})

test('a restart embeds nothing unchanged; an edit re-embeds only that note; a deletion prunes', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'alpha two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)
    const docsFirst = f.calls.texts.filter(t => t.includes('one') || t.includes('two')).length
    expect(docsFirst).toBe(2)

    // "restart": a fresh state over the same vectors dir
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, syncDebounceMs: 10, storeDebounceMs: 10 })
    f.calls.texts.length = 0
    const again = await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    expect(again[0]!.path).toBe('a.md')
    await sleep(300)
    expect(f.calls.texts.filter(t => !t.startsWith('Represent'))).toEqual([])

    f.put('b.md', 'alpha two edited')
    syncVaultEmbeddings(f.vault, ['b.md'])
    await sleep(400)
    expect(f.calls.texts.filter(t => !t.startsWith('Represent')).length).toBe(1)

    rmSync(join(f.vault, 'a.md'))
    syncVaultEmbeddings(f.vault, ['a.md'])
    await sleep(400)
    const after = (await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })) as { path: string }[]
    expect(after.map(h => h.path)).toEqual(['b.md'])
}, 20_000)

test('while nothing is embedded yet the answer is warming, not an empty list', async () => {
    const f = fixture({ slowEmbed: true })
    f.put('a.md', 'beta one')
    const r = await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })
    expect(r).toMatchObject({ unavailable: 'warming' })
})

test('edits and deletions made while the switch is off show up once it is back on', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    f.put('b.md', 'alpha two')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)

    f.put('.settings', 'embeddings:\n  enabled: false\n')
    syncVaultEmbeddings(f.vault)
    f.put('b.md', 'gamma three edited')
    rmSync(join(f.vault, 'a.md'))
    syncVaultEmbeddings(f.vault, ['b.md', 'a.md'])

    f.put('.settings', 'embeddings:\n  enabled: true\n')
    syncVaultEmbeddings(f.vault)
    await sleep(500)
    const hits = (await vaultSemanticSearch(f.vault, 'gamma', { waitMs: 2000 })) as {
        path: string
        excerpt: string
    }[]
    expect(hits.map(h => h.path)).toEqual(['b.md'])
    expect(hits[0]!.excerpt).toContain('edited')
}, 20_000)

test('a pending debounce timer does not embed after the switch flips off', async () => {
    const f = fixture()
    f.put('a.md', 'beta one')
    await settled(() => vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 }))
    await sleep(100)
    f.calls.texts.length = 0

    f.put('a.md', 'beta one changed')
    syncVaultEmbeddings(f.vault, ['a.md'])
    f.put('.settings', 'embeddings:\n  enabled: false\n')
    syncVaultEmbeddings(f.vault)
    await sleep(300)
    expect(f.calls.texts).toEqual([])
})

test('build: a cold one-shot query embeds the vault itself and answers on the first call', async () => {
    const f = fixture()
    // A debounce the process would never live to see, as in a CLI that exits after one query.
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, storeDebounceMs: 60_000 })
    f.put('a.md', '# alpha note\nalpha words')
    f.put('b.md', '# beta note\nbeta words')
    expect(await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000 })).toMatchObject({ unavailable: 'warming' })
    const r = await vaultSemanticSearch(f.vault, 'beta', { waitMs: 2000, build: true })
    expect(isSemanticUnavailable(r)).toBe(false)
    expect((r as { path: string }[])[0]!.path).toBe('b.md')
    expect(await vaultSemanticNeighbours(f.vault, 'a.md', { waitMs: 2000, build: true })).toMatchObject([{ path: 'b.md' }])
})

test('build: a pass that outlasts the budget answers warming with its progress', async () => {
    const f = fixture({ slowEmbed: true })
    configureVaultEmbed({ channel: f.channel, vectorsDir: f.vectors, storeDebounceMs: 60_000 })
    f.put('a.md', '# alpha note\nalpha words')
    const r = await vaultSemanticSearch(f.vault, 'alpha', { waitMs: 50, build: true })
    expect(r).toMatchObject({ unavailable: 'warming' })
    expect(isSemanticUnavailable(r) && r.message).toContain('0 of 1 notes embedded')
})
