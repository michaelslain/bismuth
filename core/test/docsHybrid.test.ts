import { test, expect, afterAll, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import { configureDocsEmbed } from '../src/docsEmbed'
import { docsHybridSearch, docsSearchRoute } from '../src/docsHybrid'
import { searchDocs } from '../../mcp/src/docs'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => configureDocsEmbed())

// Fake model: hashed bag of words over a small stem list, where the embedding family of words also
// lights up the "semantic" features, standing in for what a real model knows. Deterministic.
const STOP = new Set(['how', 'do', 'does', 'the', 'a', 'an', 'of', 'to', 'is', 'in', 'and', 'it', 'work', 'works'])
const FAMILY = new Set(['embedd', 'embed', 'vector', 'semantic', 'mean'])
const stem = (w: string) => w.replace(/(ings|ing|es|s|ed)$/, '')
const DIMS = 8192
const embedText = (t: string): Float32Array => {
    const v = new Float32Array(DIMS)
    const bump = (w: string) => {
        let h = 0
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
        v[h % DIMS]! += 1
    }
    for (const raw of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        if (STOP.has(raw)) continue
        const w = stem(raw)
        bump(w)
        if (FAMILY.has(w)) for (const f of FAMILY) bump(f)
    }
    const n = Math.hypot(...v) || 1
    return v.map(x => x / n)
}

const fakeChannel = () => {
    const mk = (): LiveEmbedder => ({ loaded: () => true, dispose() {}, embed: async texts => texts.map(embedText) })
    return createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
}

const vaultWith = (enabled: boolean) => {
    const v = tempDir('vault-')
    writeFileSync(join(v, '.settings'), `embeddings:\n  enabled: ${enabled}\n`)
    return v
}

function docsTree(files: Record<string, string>) {
    const root = tempDir('docs-')
    for (const [rel, body] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true })
        writeFileSync(join(root, rel), body)
    }
    return root
}

// Page A holds the query's words and nothing about meaning; page B is about the meaning side but
// shares no query word; page C is unrelated to both.
const TREE = {
    'a/noise.md': '# Noise\n\n## Lists\n\nhow to work with lists: a list of things to do and how they work\n',
    'b/semantic.md': '# Semantic\n\n## Vectors\n\nvector similarity ranks sections by meaning\n',
    'c/garden.md': '# Garden\n\n## Tomatoes\n\ntomato plants need water and sun\n',
}

test('hybrid brings in a meaning-only hit above an unrelated page, scores normalised to the best', async () => {
    const root = docsTree(TREE)
    configureDocsEmbed({ channel: fakeChannel(), vectorsDir: tempDir('dv-'), docsRoot: root, storeDebounceMs: 10 })
    const r = await docsHybridSearch('how to work with embeddings', {
        limit: 10,
        vault: vaultWith(true),
        docsRoot: root,
        build: true,
    })
    expect(r.mode).toBe('hybrid')
    const paths = r.hits.map(h => h.path)
    // the keyword side finds nothing for "embeddings"; the meaning side alone brings the page in, above the unrelated one
    expect(searchDocs(root, 'embeddings')).toEqual([])
    expect(paths).toContain('b/semantic.md#vectors')
    expect(paths.indexOf('b/semantic.md#vectors')).toBeLessThan(paths.indexOf('c/garden.md#tomatoes'))
    expect(r.hits[0]!.score).toBe(1)
    for (let i = 1; i < r.hits.length; i++) expect(r.hits[i]!.score).toBeLessThanOrEqual(r.hits[i - 1]!.score)
    for (const h of r.hits) expect(Object.keys(h).sort()).toEqual(['heading', 'path', 'score', 'snippet'])
})

test('a section only the keyword side finds outranks a better meaning match that has no keyword hit', async () => {
    const root = docsTree({
        'b/semantic.md': TREE['b/semantic.md'],
        'c/garden.md': TREE['c/garden.md'],
        'k/kiosk.md': '# Kiosk\n\n## Setup\n\nthe kiosk needs a stand, a screen, a cable, a plug, a lock, a sign, a mat and a key\n',
    })
    configureDocsEmbed({ channel: fakeChannel(), vectorsDir: tempDir('dv-'), docsRoot: root, storeDebounceMs: 10 })
    const r = await docsHybridSearch('kiosk embeddings', { limit: 10, vault: vaultWith(true), docsRoot: root, build: true })
    expect(searchDocs(root, 'kiosk embeddings').every(h => h.path.startsWith('k/'))).toBe(true)
    expect(r.hits[0]!.path.startsWith('k/')).toBe(true)
    expect(r.hits.map(h => h.path)).toContain('b/semantic.md#vectors')
})

test('the blend decides which side leads: a keyword weight of 0 orders by meaning alone', async () => {
    const root = docsTree({
        'b/semantic.md': TREE['b/semantic.md'],
        'k/kiosk.md': '# Kiosk\n\n## Setup\n\nthe kiosk needs a stand, a screen, a cable, a plug, a lock, a sign, a mat and a key\n',
    })
    configureDocsEmbed({ channel: fakeChannel(), vectorsDir: tempDir('dv-'), docsRoot: root, storeDebounceMs: 10 })
    const opts = { limit: 10, vault: vaultWith(true), docsRoot: root, build: true }
    const fit = (keyword: number) => ({ version: 1, weights: { meaning: 1, keyword }, k: 10, rerank: false, fitOn: { cases: 1, objective: 'x', at: '' } })
    const equal = await docsHybridSearch('kiosk embeddings', { ...opts, fusion: null })
    expect(equal.hits[0]!.path.startsWith('k/')).toBe(true)
    const meaningOnly = await docsHybridSearch('kiosk embeddings', { ...opts, fusion: fit(0) })
    expect(meaningOnly.hits[0]!.path).toBe('b/semantic.md#vectors')
})

test('embeddings off: today\'s searchDocs result, scores and order untouched', async () => {
    const root = docsTree(TREE)
    const want = searchDocs(root, 'how to work with lists', 5)
    const r = await docsHybridSearch('how to work with lists', { limit: 5, vault: vaultWith(false), docsRoot: root })
    expect(r).toEqual({ hits: want, mode: 'keyword', reason: 'off' })
    expect((await docsHybridSearch('lists', { limit: 5, docsRoot: root })).reason).toBe('off') // no vault
})

test('no model in this build: the same keyword list, reason no-worker', async () => {
    const root = docsTree(TREE)
    configureDocsEmbed({
        channel: createSemanticChannel({ compiled: true, vectorsDir: tempDir('rc-') }),
        vectorsDir: tempDir('dv-'),
        docsRoot: root,
    })
    const r = await docsHybridSearch('how to work with lists', { limit: 5, vault: vaultWith(true), docsRoot: root })
    expect(r).toEqual({ hits: searchDocs(root, 'how to work with lists', 5), mode: 'keyword', reason: 'no-worker' })
})

test('a model that is still loading answers keywords with reason warming', async () => {
    const root = docsTree(TREE)
    const never = (): LiveEmbedder => ({ loaded: () => false, dispose() {}, embed: () => new Promise(() => {}) })
    configureDocsEmbed({
        channel: createSemanticChannel({ makeEmbedder: never, vectorsDir: tempDir('rc-') }),
        vectorsDir: tempDir('dv-'),
        docsRoot: root,
    })
    const r = await docsHybridSearch('lists', { limit: 5, vault: vaultWith(true), docsRoot: root, waitMs: 80 })
    expect(r.mode).toBe('keyword')
    expect(r.reason).toBe('warming')
    expect(r.hits).toEqual(searchDocs(root, 'lists', 5))
})

test('keywordOnly forces the keyword list with the given reason', async () => {
    const root = docsTree(TREE)
    const r = await docsHybridSearch('lists', { limit: 3, vault: vaultWith(true), docsRoot: root, keywordOnly: 'warming' })
    expect(r).toEqual({ hits: searchDocs(root, 'lists', 3), mode: 'keyword', reason: 'warming' })
})

test('"how do embeddings work" ranks a semantic-search or recall page in the top 5 over the real docs', async () => {
    const root = resolve(import.meta.dir, '../../docs')
    configureDocsEmbed({ channel: fakeChannel(), vectorsDir: tempDir('dv-'), docsRoot: root, storeDebounceMs: 10 })
    const q = 'how do embeddings work'
    // today's keyword-only top hit is not the answer
    expect(searchDocs(root, q, 1)[0]!.path).not.toMatch(/semantic-search|how-recall-ranks-notes/)
    const r = await docsHybridSearch(q, { limit: 8, vault: vaultWith(true), docsRoot: root, build: true, waitMs: 60_000 })
    expect(r.mode).toBe('hybrid')
    const top5 = r.hits.slice(0, 5).map(h => h.path)
    expect(top5.some(p => p.startsWith('vault/semantic-search.md') || p === 'daemon/communication.md#how-recall-ranks-notes')).toBe(true)
}, 90_000)

test('POST /docs/search: 400 without a query, else {hits, mode}', async () => {
    const post = (body: unknown) =>
        docsSearchRoute(new Request('http://x/docs/search', { method: 'POST', body: JSON.stringify(body) }), {
            vault: vaultWith(false),
        })
    expect((await post({})).status).toBe(400)
    process.env.BISMUTH_DOCS_DIR = docsTree(TREE)
    try {
        const r = await post({ query: 'lists', limit: 2 })
        const j = (await r.json()) as { hits: unknown[]; mode: string }
        expect(j.mode).toBe('keyword')
        expect(j.hits.length).toBeGreaterThan(0)
    } finally {
        delete process.env.BISMUTH_DOCS_DIR
    }
})
