import { test, expect, afterAll, afterEach, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { encodeProjectDir } from '@bismuth/memory'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import { configureVaultEmbed } from '../src/vaultEmbed'
import { configureChatEmbed } from '../src/chatEmbed'
import { fuseRanks, hybridSearch, hybridSearchRoute } from '../src/hybridSearch'
import type { DenyEntry } from '../src/visibility'
import type { FusionModel } from '../src/sourceGate'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)

const savedConfig = process.env.CLAUDE_CONFIG_DIR
beforeEach(() => {
    process.env.CLAUDE_CONFIG_DIR = tempDir('claude-')
})
afterEach(() => {
    configureVaultEmbed()
    configureChatEmbed()
    if (savedConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = savedConfig
})

// Fake model: "stripes" (the query) and "gamma" (note text) share one direction; the rest another.
const vecOf = (t: string) => (t.includes('stripes') || t.includes('gamma') ? [0, 1, 0] : [1, 0, 0])
const entry = (rel: string): DenyEntry => ({ rel, abs: `/vault/${rel}` })

function fixture(opts: { enabled?: boolean } = {}) {
    const vault = tempDir('vault-')
    const put = (rel: string, body: string) => {
        mkdirSync(dirname(join(vault, rel)), { recursive: true })
        writeFileSync(join(vault, rel), body)
    }
    if (opts.enabled !== false) put('.settings', 'embeddings:\n  enabled: true\n')
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    configureVaultEmbed({ channel, vectorsDir: tempDir('vv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    configureChatEmbed({ channel, vectorsDir: tempDir('cv-'), syncDebounceMs: 10, storeDebounceMs: 10 })
    const chat = (id: string, text: string) => {
        const dir = join(process.env.CLAUDE_CONFIG_DIR!, 'projects', encodeProjectDir(vault))
        const at = '2026-10-20T10:00:00'
        const lines = [
            JSON.stringify({ type: 'user', timestamp: at, message: { role: 'user', content: text } }),
            JSON.stringify({ type: 'assistant', timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text }] } }),
        ]
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${id}.jsonl`), lines.join('\n') + '\n')
    }
    return { vault, put, chat }
}

/** A stand-in for the fitted blend: equal weights, so these tests pin the fusion mechanics, not the fit. */
const equalBlend: FusionModel = { version: 1, weights: { meaning: 1, keyword: 1 }, k: 60, rerank: false, fitOn: { cases: 1, objective: 'test', at: '' } }
const base = { limit: 10, deny: [] as DenyEntry[], channel: 'chat' as const, rerank: false, build: true, waitMs: 5000, fusion: equalBlend }

test('fuseRanks: summed reciprocal ranks, best first, first list keeps the item', () => {
    const key = (s: string) => s[0]
    const r = fuseRanks([
        { key, items: ['a1', 'b1', 'c1'] },
        { key, items: ['c2', 'b2'] },
    ])
    expect(r.map(x => x.item)).toEqual(['c1', 'b1', 'a1'])
    expect(r[0].score).toBeCloseTo(1 / 63 + 1 / 61)
    expect(r[1].score).toBeCloseTo(1 / 62 + 1 / 62)
})

test('fuseRanks: an empty input fuses to nothing', () => {
    expect(fuseRanks([])).toEqual([])
    expect(fuseRanks([{ key: String, items: [] }])).toEqual([])
})

function corpus() {
    const f = fixture()
    f.put('keyonly.md', '# one\nzebra zebra zebra')
    f.put('both.md', '# two\nzebra and gamma')
    f.put('meaning.md', '# three\ngamma gamma')
    for (const n of ['d1', 'd2', 'd3', 'd4']) f.put(`${n}.md`, `# ${n}\nplain filler ${n}`)
    return f
}

test('fusion: a keyword-only #1 and a meaning-only #1 land in the top 3, a doc good at both beats each', async () => {
    const f = corpus()
    const r = await hybridSearch(f.vault, 'zebra stripes', base)
    expect(r.mode).toBe('hybrid')
    const paths = r.hits.map(h => h.path)
    expect(paths[0]).toBe('both.md')
    expect(paths.slice(0, 3)).toContain('keyonly.md')
    expect(paths.slice(0, 3)).toContain('meaning.md')
    expect(r.hits[0].score).toBe(1)
    expect(r.hits.every(h => h.score > 0 && h.score <= 1)).toBe(true)
    expect(r.hits.every(h => h.kind === 'note')).toBe(true)
})

test('limit cuts the list', async () => {
    const f = corpus()
    const r = await hybridSearch(f.vault, 'zebra stripes', { ...base, limit: 2 })
    expect(r.hits.length).toBe(2)
})

test('embeddings off: keyword hits in the same shape, reason off', async () => {
    const f = fixture({ enabled: false })
    f.put('z.md', '# z\nzebra here')
    const r = await hybridSearch(f.vault, 'zebra', base)
    expect(r.mode).toBe('keyword')
    expect(r.reason).toBe('off')
    expect(r.hits).toEqual([{ path: 'z.md', kind: 'note', score: 1, excerpt: 'zebra here' }])
})

test('no worker: keyword hits, reason no-worker', async () => {
    const f = fixture()
    f.put('z.md', '# z\nzebra here')
    configureVaultEmbed({
        channel: createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' }),
        vectorsDir: tempDir('vv-'),
    })
    const r = await hybridSearch(f.vault, 'zebra', base)
    expect(r).toMatchObject({ mode: 'keyword', reason: 'no-worker' })
    expect(r.hits.map(h => h.path)).toEqual(['z.md'])
})

test('keywordOnly forces the keyword list with the given reason', async () => {
    const f = corpus()
    const r = await hybridSearch(f.vault, 'zebra', { ...base, keywordOnly: 'warming' })
    expect(r).toMatchObject({ mode: 'keyword', reason: 'warming' })
    expect(r.hits.map(h => h.path)).toContain('keyonly.md')
})

test('denied paths never appear on either side', async () => {
    const f = fixture()
    f.put('Private/s.md', '# s\nzebra gamma gamma')
    f.put('open.md', '# o\nzebra and gamma')
    const r = await hybridSearch(f.vault, 'zebra stripes', { ...base, deny: [entry('Private/s.md')] })
    expect(r.hits.map(h => h.path)).toEqual(['open.md'])
    const kw = await hybridSearch(f.vault, 'zebra', { ...base, deny: [entry('Private')], keywordOnly: 'off' })
    expect(kw.hits.map(h => h.path)).toEqual(['open.md'])
})

test('chats blend in for the owner and are dropped when the vault restricts a note', async () => {
    const f = fixture()
    f.put('open.md', '# o\nplain zebra words')
    f.chat('sess-1', 'gamma gamma chat about stripes')
    const open = await hybridSearch(f.vault, 'zebra stripes', { ...base, channel: 'daemon' })
    const chat = open.hits.find(h => h.kind === 'chat')
    expect(chat).toMatchObject({ path: 'chat sess-1', session: 'sess-1', date: '2026-10-20' })
    f.put('Private/s.md', '# s\nhidden')
    const restricted = await hybridSearch(f.vault, 'zebra stripes', {
        ...base,
        channel: 'daemon',
        deny: [entry('Private/s.md')],
    })
    expect(restricted.hits.some(h => h.kind === 'chat')).toBe(false)
})

test('the route validates the query and answers a HybridResult', async () => {
    const f = fixture({ enabled: false })
    f.put('z.md', '# z\nzebra here')
    const post = (b: unknown) =>
        hybridSearchRoute(new Request('http://x/search/hybrid', { method: 'POST', body: JSON.stringify(b) }), {
            vault: f.vault,
            deny: [],
            channel: 'owner',
        })
    expect((await post({})).status).toBe(400)
    const r = await post({ query: 'zebra', limit: 5 })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ mode: 'keyword', reason: 'off', hits: [{ path: 'z.md', kind: 'note' }] })
})

test('fuseRanks: a list weight scales its terms, and no weight means 1', () => {
    const a = { key: (t: string) => t, items: ['x', 'y'] }
    const b = { key: (t: string) => t, items: ['y', 'z'] }
    const equal = fuseRanks([a, b], 10).map(f => f.item)
    expect(equal[0]).toBe('y')
    // keyword-heavy: b's first item leads; a zero weight leaves a list only to break ties
    expect(fuseRanks([a, { ...b, weight: 0 }], 10).map(f => f.item).slice(0, 2)).toEqual(['x', 'y'])
    expect(fuseRanks([{ ...a, weight: 0.1 }, { ...b, weight: 5 }], 10).map(f => f.item)[0]).toBe('y')
    expect(fuseRanks([a], 10)[0]!.score).toBeCloseTo(1 / 11, 12)
    expect(fuseRanks([{ ...a, weight: 3 }], 10)[0]!.score).toBeCloseTo(3 / 11, 12)
})

test('a missing blend model answers from keywords alone and says why', async () => {
    const { vault, put } = fixture()
    put('alpha.md', 'stripes are in here')
    const r = await hybridSearch(vault, 'stripes', { ...base, fusion: null })
    expect(r.mode).toBe('keyword')
    expect(r.reason).toBe('blend model missing')
})

test('the blend model decides the order: a keyword-silent fit ranks by meaning', async () => {
    const { vault, put } = fixture()
    put('kw.md', 'stripes stripes stripes plain words about nothing')
    put('gamma.md', 'gamma')
    const meaningOnly = await hybridSearch(vault, 'stripes', { ...base, fusion: { ...equalBlend, weights: { meaning: 1, keyword: 0 } } })
    const keywordHeavy = await hybridSearch(vault, 'stripes', { ...base, fusion: { ...equalBlend, weights: { meaning: 0.001, keyword: 1 } } })
    // a keyword weight of 0 leaves keyword-only order out of the scores; a tiny meaning weight lets the keyword rank lead
    expect(meaningOnly.hits.map(h => h.path)).toContain('gamma.md')
    expect(keywordHeavy.hits[0]!.path).toBe('kw.md')
})

test('the route with agent applies the deny list before ranking, and only for the owner', async () => {
    const f = fixture({ enabled: false })
    f.put('.settings', 'folderVisibility:\n  Private: hidden\n')
    for (const n of ['a', 'b', 'c']) f.put(`Private/${n}.md`, `# ${n}\nzebra zebra zebra zebra`)
    for (const n of ['x', 'y']) f.put(`${n}.md`, `# ${n}\nzebra`)
    const post = (channel: 'owner' | 'chat', b: unknown) =>
        hybridSearchRoute(new Request('http://x/search/hybrid', { method: 'POST', body: JSON.stringify(b) }), {
            vault: f.vault,
            deny: [],
            channel,
        })
    const agent = await (await post('owner', { query: 'zebra', limit: 2, agent: 'chat' })).json()
    expect(agent.hits.map((h: { path: string }) => h.path).sort()).toEqual(['x.md', 'y.md'])
    const forged = await (await post('chat', { query: 'zebra', limit: 5, agent: 'chat' })).json()
    expect(forged.hits.some((h: { path: string }) => h.path.startsWith('Private/'))).toBe(true)
})
