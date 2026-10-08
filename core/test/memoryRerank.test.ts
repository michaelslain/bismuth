import { test, expect } from 'bun:test'
import { join } from 'node:path'
import createReranker, { RERANK_TIMEOUT_MS, RERANK_WORKER_ARG, RERANK_MODEL } from '../src/memoryRerank'
import type { Extractor } from '../src/memoryEmbed'

type Log = { loads: number; disposed: number; runs: string[][] }
function fakeExtractor(log: Log, logitOf: (t: string) => number = t => t.length): Extractor {
    let alive = true
    return {
        alive: () => alive,
        async run(texts) {
            log.runs.push(texts)
            const ps = texts.slice(1)
            return { data: Float32Array.from(ps.map(logitOf)), dims: [ps.length, 1] }
        },
        dispose() {
            alive = false
            log.disposed++
        },
    }
}
const make = (over: Partial<Parameters<typeof createReranker>[0]> = {}, log?: Log) => {
    const l = log ?? { loads: 0, disposed: 0, runs: [] }
    const r = createReranker({
        cacheDir: '/c',
        load: async () => {
            l.loads++
            return fakeExtractor(l)
        },
        ...over,
    })
    return { r, log: l }
}

test('constants', () => {
    expect(RERANK_TIMEOUT_MS).toBe(700)
    expect(RERANK_WORKER_ARG).toBe('--bismuth-rerank-worker')
    expect(RERANK_MODEL).toBe('Xenova/ms-marco-MiniLM-L-6-v2')
})

test('loads lazily once, sends [query, ...passages], returns one logit per passage', async () => {
    const { r, log } = make()
    expect(log.loads).toBe(0)
    const [a, b] = await Promise.all([r.rerank('q', ['aa', 'bbbb']), r.rerank('q2', ['c'])])
    expect(log.loads).toBe(1)
    expect(a).toEqual([2, 4])
    expect(b).toEqual([1])
    expect(log.runs[0]).toEqual(['q', 'aa', 'bbbb'])
    r.dispose()
})

test('no passages: empty, and no load', async () => {
    const { r, log } = make()
    expect(await r.rerank('q', [])).toEqual([])
    expect(log.loads).toBe(0)
})

test('idle unload, then the next call reloads', async () => {
    const { r, log } = make({ idleMs: 20 })
    await r.rerank('q', ['a'])
    await new Promise(res => setTimeout(res, 80))
    expect(log.disposed).toBe(1)
    await r.rerank('q', ['a'])
    expect(log.loads).toBe(2)
    r.dispose()
})

test('a failed load rejects, then backs off without retrying; recovers after the window', async () => {
    let t = 100
    let loads = 0
    const r = createReranker({
        cacheDir: '/c',
        now: () => t,
        load: async () => {
            loads++
            if (loads === 1) throw new Error('offline')
            return fakeExtractor({ loads: 0, disposed: 0, runs: [] })
        },
    })
    await expect(r.rerank('q', ['a'])).rejects.toThrow('offline')
    t = 1100
    await expect(r.rerank('q', ['a'])).rejects.toThrow('failed recently')
    expect(loads).toBe(1)
    t = 31_200
    expect(await r.rerank('q', ['abc'])).toEqual([3])
    expect(loads).toBe(2)
    r.dispose()
})

test('a wrong-shaped reply rejects', async () => {
    const r = createReranker({
        cacheDir: '/c',
        load: async () => ({
            run: async () => ({ data: new Float32Array(1), dims: [1, 1] }),
            dispose() {},
        }),
    })
    await expect(r.rerank('q', ['a', 'b'])).rejects.toThrow('shape')
})

test('core boot (server.ts) never statically reaches the reranker model packages', () => {
    const src = join(import.meta.dir, '../src')
    for (const f of ['memoryRerank.ts', 'rerankWorker.ts', 'embedWorkerBoot.ts']) {
        const text = require('node:fs').readFileSync(join(src, f), 'utf8') as string
        expect(text).not.toMatch(/^import[^\n]*['"](@huggingface\/transformers|onnxruntime-)/m)
    }
})
