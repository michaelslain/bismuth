import { test, expect, afterAll, afterEach } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSemanticChannel } from '../src/memoryEmbed'
import type { LiveEmbedder } from '../src/memoryEmbed'
import { configureDocsEmbed, DOCS_PASS_BATCH_NOTES, docsIndexReady, docsSourceHits, syncDocsEmbeddings } from '../src/docsEmbed'
import { tempDir, sweepTempDirs } from './tempDirs'

afterAll(sweepTempDirs)
afterEach(() => configureDocsEmbed())

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Fake model: bag of words hashed into 32 dims, unit length.
const embedText = (t: string): Float32Array => {
    const v = new Float32Array(32)
    for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        let h = 0
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) >>> 0
        v[h % 32]! += 1
    }
    const n = Math.hypot(...v) || 1
    return v.map(x => x / n)
}

const TOPICS = ['calendar', 'flashcard', 'kanban', 'terminal', 'graph', 'drawing', 'sheets', 'tasks']

// Eight pages of four short sections each: 32 sections, one chunk apiece.
function fixture(docsRoot?: string | null) {
    const root = tempDir('docs-')
    for (const t of TOPICS) {
        const body = [`# ${t} page`, '', `${t} intro`]
        for (const s of ['setup', 'keys', 'failures', 'verify']) body.push('', `## ${t} ${s}`, `how ${t} ${s} works`)
        writeFileSync(join(root, `${t}.md`), body.join('\n') + '\n')
    }
    const calls: number[] = []
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.push(texts.length)
            return texts.map(embedText)
        },
    })
    const channel = createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') })
    const vectorsDir = tempDir('dv-')
    configureDocsEmbed({ channel, vectorsDir, docsRoot: docsRoot === undefined ? root : docsRoot, storeDebounceMs: 10 })
    return { root, calls, channel, vectorsDir }
}

const query = (text: string, k = 5) => ({ vec: embedText(text), k, channel: 'chat' as const })

test('docsIndexReady embeds the whole tree in slices, so a query never waits behind one call', async () => {
    const f = fixture()
    expect(await docsIndexReady()).toBe(true)
    const total = f.calls.reduce((a, b) => a + b, 0)
    expect(total).toBe(TOPICS.length * 5)
    expect(f.calls.length).toBeGreaterThan(1)
    for (const n of f.calls) expect(n).toBeLessThanOrEqual(DOCS_PASS_BATCH_NOTES)
    // the first docs question after the warmup answers from the built index
    const hits = await docsSourceHits(query('how kanban keys works'))
    expect(hits[0]!.id).toBe('kanban.md#kanban-keys')
})

test('syncDocsEmbeddings builds the index in the background without a query', async () => {
    const f = fixture()
    syncDocsEmbeddings()
    expect(f.calls.length).toBe(0) // returns at once; the pass is debounced
    for (let i = 0; i < 100 && f.calls.reduce((a, b) => a + b, 0) < TOPICS.length * 5; i++) await sleep(20)
    expect(f.calls.reduce((a, b) => a + b, 0)).toBe(TOPICS.length * 5)
    const before = f.calls.length
    expect(await docsIndexReady()).toBe(true)
    expect(f.calls.length).toBe(before) // nothing left to embed
})

test('a restart reuses the persisted docs vectors', async () => {
    const f = fixture()
    expect(await docsIndexReady()).toBe(true)
    const calls: number[] = []
    const mk = (): LiveEmbedder => ({
        loaded: () => true,
        dispose() {},
        async embed(texts) {
            calls.push(texts.length)
            return texts.map(embedText)
        },
    })
    configureDocsEmbed({
        channel: createSemanticChannel({ makeEmbedder: mk, vectorsDir: tempDir('rc-') }),
        vectorsDir: f.vectorsDir,
        docsRoot: f.root,
        storeDebounceMs: 10,
    })
    expect(await docsIndexReady()).toBe(true)
    expect(calls.length).toBe(0)
})

test('docsSourceHits keeps one hit per page, its best section', async () => {
    fixture()
    expect(await docsIndexReady()).toBe(true)
    const hits = await docsSourceHits(query('how kanban keys works', 5))
    expect(hits[0]!.id).toBe('kanban.md#kanban-keys')
    const pages = hits.map(h => h.id.split('#')[0])
    expect(new Set(pages).size).toBe(pages.length)
    expect(hits).toHaveLength(5)
})

test('docsIndexReady is false with no docs root', async () => {
    fixture(null)
    expect(await docsIndexReady()).toBe(false)
    syncDocsEmbeddings() // a no-op, never a throw
})
