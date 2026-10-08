import { test, expect, afterAll } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import createEmbedder, {
    backoffFor,
    workerAvailable,
    createSemanticChannel,
    createVectorStore,
    loadWorkerExtractor,
    type Extractor,
    type LiveEmbedder,
} from '../src/memoryEmbed'
import { createRecallService, type Embedder } from '../src/memoryRecall'
import { tempDir, sweepTempDirs } from './tempDirs'
import type { MemoryNote } from '@bismuth/memory'

afterAll(sweepTempDirs)

const mkNote = (name: string, content: string): MemoryNote =>
    ({
        name,
        content,
        backlinks: [],
        frontmatter: { type: 'fact', tags: [] },
    }) as unknown as MemoryNote

// A fake model: a vector is [1, 0] unless the text mentions "beta", then [0, 1]. Normalized.
const vecOf = (t: string) => (t.includes('beta') ? [0, 1] : [1, 0])
function fakeExtractor(log: { loads: number; disposes: number; runs: string[][] }): Extractor {
    return {
        async run(texts) {
            log.runs.push(texts)
            return { data: Float32Array.from(texts.flatMap(vecOf)), dims: [texts.length, 2] }
        },
        dispose() {
            log.disposes++
        },
    }
}
const newLog = () => ({ loads: 0, disposes: 0, runs: [] as string[][] })
const embedderWith = (log: ReturnType<typeof newLog>, idleMs = 60_000) =>
    createEmbedder({
        cacheDir: '/unused',
        idleMs,
        load: async () => {
            log.loads++
            return fakeExtractor(log)
        },
    })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// --- boot never reaches the model -------------------------------------------------------------

const SRC = resolve(import.meta.dir, '../src')
const staticImports = (file: string): string[] =>
    new Bun.Transpiler({ loader: 'ts' })
        .scanImports(readFileSync(file, 'utf8'))
        .filter(i => i.kind === 'import-statement')
        .map(i => i.path)

/** Every core/src file statically reachable from `entry` (relative imports only), plus the bare
 *  specifiers each one imports. */
function staticGraph(entry: string) {
    const seen = new Set<string>()
    const bare = new Set<string>()
    const walk = (file: string) => {
        if (seen.has(file)) return
        seen.add(file)
        for (const p of staticImports(file)) {
            if (!p.startsWith('.')) {
                bare.add(p)
                continue
            }
            const base = resolve(dirname(file), p)
            const hit = ['.ts', '.tsx', '/index.ts'].map(e => base + e).find(existsSync)
            if (hit) walk(hit)
        }
    }
    walk(entry)
    return { files: seen, bare }
}

test('core boot (server.ts) statically reaches the embedder module but never the model packages', () => {
    const g = staticGraph(join(SRC, 'server.ts'))
    expect(g.files.has(join(SRC, 'memoryEmbed.ts'))).toBe(true)
    for (const spec of g.bare)
        expect(spec).not.toMatch(/^(@huggingface\/transformers|onnxruntime-)/)
})

test('the iPad in-process backend never reaches the embedder or the recall service', () => {
    const g = staticGraph(join(SRC, 'localBackend.ts'))
    expect(g.files.has(join(SRC, 'memoryEmbed.ts'))).toBe(false)
    expect(g.files.has(join(SRC, 'memoryRecall.ts'))).toBe(false)
})

// --- embedder lifecycle -----------------------------------------------------------------------

test('the model loads on the first embed only, and is shared by concurrent first calls', async () => {
    const log = newLog()
    const e = embedderWith(log)
    expect(log.loads).toBe(0)
    expect(e.loaded()).toBe(false)
    const [a, b] = await Promise.all([e.embed(['alpha']), e.embed(['beta'])])
    expect(log.loads).toBe(1)
    expect(Array.from(a[0]!)).toEqual([1, 0])
    expect(Array.from(b[0]!)).toEqual([0, 1])
    e.dispose()
})

test('after idleMs with no query the model is disposed, and the next embed reloads it', async () => {
    const log = newLog()
    const e = embedderWith(log, 40)
    await e.embed(['alpha'])
    expect(e.loaded()).toBe(true)
    await sleep(120)
    expect(e.loaded()).toBe(false)
    expect(log.disposes).toBe(1)
    await e.embed(['alpha'])
    expect(log.loads).toBe(2)
    e.dispose()
})

test('a failed load is not retried on every call', async () => {
    let loads = 0
    const e = createEmbedder({
        cacheDir: '/unused',
        load: async () => {
            loads++
            throw new Error('offline')
        },
    })
    await expect(e.embed(['x'])).rejects.toThrow('offline')
    await expect(e.embed(['x'])).rejects.toThrow('recently')
    expect(loads).toBe(1)
})

// --- vector store -----------------------------------------------------------------------------

function countingEmbedder() {
    const state = { embedded: [] as string[] }
    const embedder: Embedder = {
        async embed(texts) {
            state.embedded.push(...texts)
            return texts.map(t => Float32Array.from(vecOf(t)))
        },
        dispose() {},
    }
    return { state, embedder }
}

test('touching one note re-embeds exactly that one, after the debounce', async () => {
    const dir = tempDir('vec-')
    const { state, embedder } = countingEmbedder()
    const runs: number[] = []
    const store = createVectorStore(dir, '/mem', {
        embedder,
        debounceMs: 60,
        onEmbed: n => runs.push(n),
    })
    const notes = [mkNote('a', 'alpha one'), mkNote('b', 'beta two'), mkNote('c', 'alpha three')]
    await store.scores(Float32Array.from([1, 0]), notes)
    expect(state.embedded.length).toBe(0) // debounced: nothing yet
    await store.flush()
    expect(runs).toEqual([3])

    notes[1] = mkNote('b', 'beta two edited')
    const s = await store.scores(Float32Array.from([1, 0]), notes)
    expect([...s.keys()].sort()).toEqual(['a', 'c']) // b is stale, so it has no score yet
    await sleep(20)
    expect(runs).toEqual([3]) // still inside the debounce window
    await store.flush()
    expect(runs).toEqual([3, 1])
    expect(state.embedded.filter(t => t.includes('edited')).length).toBe(1)
})

test('scores are cosines, best first, and only the top 10 are returned', async () => {
    const dir = tempDir('vec-')
    const { embedder } = countingEmbedder()
    const store = createVectorStore(dir, '/mem', { embedder, debounceMs: 10 })
    const notes = Array.from({ length: 14 }, (_, i) =>
        mkNote(`n${i}`, i === 13 ? 'beta only' : `alpha ${i}`),
    )
    await store.scores(Float32Array.from([0, 1]), notes)
    await store.flush()
    const s = await store.scores(Float32Array.from([0, 1]), notes)
    expect(s.size).toBe(10)
    expect([...s][0]).toEqual(['n13', 1])
})

test('vectors survive a restart: a second store over the same dir embeds 0 notes', async () => {
    const dir = tempDir('vec-')
    const notes = [mkNote('a', 'alpha one'), mkNote('b', 'beta two')]
    const first = countingEmbedder()
    const s1 = createVectorStore(dir, '/mem', { embedder: first.embedder, debounceMs: 10 })
    await s1.scores(Float32Array.from([1, 0]), notes)
    await s1.flush()
    expect(first.state.embedded.length).toBe(2)

    const second = countingEmbedder()
    const s2 = createVectorStore(dir, '/mem', { embedder: second.embedder, debounceMs: 10 })
    const scores = await s2.scores(Float32Array.from([1, 0]), notes)
    await s2.flush()
    expect(second.state.embedded.length).toBe(0)
    expect(scores.get('a')).toBe(1)
    expect(scores.get('b')).toBe(0)
})

test('a deleted note is pruned from the persisted vectors', async () => {
    const dir = tempDir('vec-')
    const { embedder } = countingEmbedder()
    const s = createVectorStore(dir, '/mem', { embedder, debounceMs: 10 })
    await s.scores(Float32Array.from([1, 0]), [mkNote('a', 'x'), mkNote('b', 'y')])
    await s.flush()
    await s.scores(Float32Array.from([1, 0]), [mkNote('a', 'x')])
    await s.flush()
    const reread = createVectorStore(dir, '/mem', { embedder, debounceMs: 10 })
    const got = await reread.scores(Float32Array.from([1, 0]), [mkNote('a', 'x'), mkNote('b', 'y')])
    expect([...got.keys()]).toEqual(['a'])
})

// --- the channel inside recall ----------------------------------------------------------------

function channelWith(over: { slowMs?: number; throws?: boolean; log?: ReturnType<typeof newLog> } = {}) {
    const log = over.log ?? newLog()
    const vectors = tempDir('vec-')
    const channel = createSemanticChannel({
        vectorsDir: vectors,
        modelsDir: '/unused',
        debounceMs: 10,
        timeoutMs: 60,
        makeEmbedder: o => {
            const inner = createEmbedder({
                ...o,
                load: async () => {
                    log.loads++
                    if (over.throws) throw new Error('no model')
                    if (over.slowMs) await sleep(over.slowMs)
                    return fakeExtractor(log)
                },
            })
            return inner as LiveEmbedder
        },
    })
    return { channel, log }
}

const notesForRecall = [mkNote('a', 'alpha one'), mkNote('b', 'beta two')]
function recallWith(channel: ReturnType<typeof createSemanticChannel>, semantic = true) {
    return createRecallService({
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic }),
        embedder: () => channel.embedder(),
        semanticScores: channel.semanticScores,
        loadNotes: async () => notesForRecall,
    })
}
const ask = (prompt: string) => ({ mode: 'prompt' as const, sessionId: `s${Math.random()}`, prompt })

test('semantic:false never loads the model', async () => {
    const { channel, log } = channelWith()
    const svc = recallWith(channel, false)
    await svc.recall(ask('beta'))
    expect(log.loads).toBe(0)
})

test('an embedder that throws falls back to BM25 for that request', async () => {
    const { channel } = channelWith({ throws: true })
    const r = await recallWith(channel).recall(ask('beta'))
    expect(r.injected).toEqual(['b']) // the lexical match still lands
    expect(r.semantic).toBeUndefined()
})

test('a query past the 250ms-class budget falls back to BM25, and the next one is semantic', async () => {
    const { channel, log } = channelWith({ slowMs: 150 })
    const svc = recallWith(channel)
    const first = await svc.recall(ask('beta'))
    expect(first.semantic).toBeUndefined() // model still loading: BM25 only
    expect(first.injected).toEqual(['b'])
    await sleep(200) // the load finished in the background
    await channel.stores.get('/mem')!.flush()
    const second = await svc.recall(ask('beta'))
    expect(second.semantic).toBe(true)
    expect(log.loads).toBe(1)
    channel.embedder()!.dispose()
})

test('the query carries the bge prefix and documents do not', async () => {
    const { channel, log } = channelWith()
    const svc = recallWith(channel)
    await svc.recall(ask('beta'))
    await sleep(30)
    await channel.stores.get('/mem')!.flush()
    const texts = log.runs.flat()
    expect(texts.some(t => t.startsWith('Represent this sentence for searching relevant passages: '))).toBe(true)
    expect(texts.filter(t => t.startsWith('Represent this')).length).toBe(1)
    channel.embedder()!.dispose()
})

// --- the child process ------------------------------------------------------------------------

const FAKE = join(import.meta.dir, 'fixtures/fakeEmbedWorker.ts')
const fakeCmd = [process.execPath, 'run', FAKE]
const withMode = (mode: string) => {
    process.env.FAKE_MODE = mode
    return () => delete process.env.FAKE_MODE
}
const waitFor = async (f: () => boolean, ms = 3000) => {
    for (const t = Date.now(); !f() && Date.now() - t < ms; ) await sleep(20)
    return f()
}
const pidAlive = (pid: number) => {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

test('worker child: round-trips vectors, and dispose ends the process', async () => {
    const x = await loadWorkerExtractor('/unused', { command: fakeCmd })
    const { data, dims } = await x.run(['alpha', 'beta'])
    expect(dims).toEqual([2, 2])
    expect(Array.from(data)).toEqual([1, 0, 0, 1])
    expect(x.alive?.()).toBe(true)
    const pid = x.pid!
    expect(pidAlive(pid)).toBe(true)
    x.dispose()
    expect(x.alive?.()).toBe(false)
    expect(await waitFor(() => !pidAlive(pid))).toBe(true) // the process really ended
    await expect(x.run(['alpha'])).rejects.toThrow()
})

test('worker child: after idleMs the process is gone, and the next embed spawns a fresh one', async () => {
    let pid = 0
    const e = createEmbedder({
        cacheDir: '/unused',
        idleMs: 80,
        load: async dir => {
            const x = await loadWorkerExtractor(dir, { command: fakeCmd })
            pid = x.pid!
            return x
        },
    })
    await e.embed(['alpha'])
    expect(e.loaded()).toBe(true)
    expect(pidAlive(pid)).toBe(true)
    await sleep(300)
    expect(e.loaded()).toBe(false)
    expect(await waitFor(() => !pidAlive(pid))).toBe(true) // idle exit returns the memory to the OS
    const [v] = await e.embed(['beta'])
    expect(Array.from(v!)).toEqual([0, 1])
    e.dispose()
})

test('worker child: a crash fails that request, and the next one respawns', async () => {
    const reset = withMode('crash')
    const e = createEmbedder({ cacheDir: '/unused', workerCommand: fakeCmd })
    await expect(e.embed(['alpha'])).rejects.toThrow()
    expect(e.loaded()).toBe(false) // the dead child was dropped
    reset()
    const [v] = await e.embed(['alpha']) // a fresh child, no mode now
    expect(Array.from(v!)).toEqual([1, 0])
    e.dispose()
})

test('worker child: crashing twice in a row backs off instead of respawning per prompt', async () => {
    const reset = withMode('crash')
    const e = createEmbedder({ cacheDir: '/unused', workerCommand: fakeCmd })
    await expect(e.embed(['a'])).rejects.toThrow()
    await expect(e.embed(['a'])).rejects.toThrow()
    reset()
    await expect(e.embed(['a'])).rejects.toThrow('recently') // no third spawn inside the window
})

test('worker child: a hung child times the request out and is killed', async () => {
    const reset = withMode('hang')
    const x = await loadWorkerExtractor('/unused', { command: fakeCmd, runTimeoutMs: 150 })
    reset()
    const pid = x.pid!
    await expect(x.run(['alpha'])).rejects.toThrow('timed out')
    expect(x.alive?.()).toBe(false)
    expect(await waitFor(() => !pidAlive(pid))).toBe(true) // killed, not merely marked dead
})

test('worker child: a model that cannot load rejects the load with its error', async () => {
    const reset = withMode('loadfail')
    await expect(loadWorkerExtractor('/unused', { command: fakeCmd })).rejects.toThrow('no model here')
    reset()
})

test('worker child: exits when its stdin closes (parent gone)', async () => {
    const child = Bun.spawn(fakeCmd, { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
    const pid = child.pid
    await sleep(500) // loaded and waiting
    expect(pidAlive(pid)).toBe(true)
    child.stdin.end()
    const code = await Promise.race([child.exited, sleep(5000).then(() => 'hung')])
    expect(code).toBe(0)
    expect(pidAlive(pid)).toBe(false)
})

test('worker child: a parent that is killed outright leaves no orphan', async () => {
    const script = join(tempDir('orphan-'), 'parent.ts')
    await Bun.write(
        script,
        `import { loadWorkerExtractor } from ${JSON.stringify(join(SRC, 'memoryEmbed'))}
const x = await loadWorkerExtractor('/unused', { command: ${JSON.stringify(fakeCmd)} })
await x.run(['alpha'])
await new Promise(() => {})`,
    )
    const parent = Bun.spawn([process.execPath, 'run', script], { stdout: 'pipe', stderr: 'ignore' })
    // Find the worker by its command line: it is the only process running the fixture.
    let pids: number[] = []
    for (let i = 0; i < 50 && !pids.length; i++) {
        await sleep(100)
        const ps = Bun.spawnSync(['pgrep', '-f', FAKE]).stdout.toString()
        pids = ps.split('\n').filter(Boolean).map(Number).filter(p => p !== process.pid)
    }
    expect(pids.length).toBeGreaterThan(0)
    parent.kill(9)
    await parent.exited
    for (let i = 0; i < 50 && pids.some(pidAlive); i++) await sleep(100)
    expect(pids.some(pidAlive)).toBe(false)
})

// --- the real model (opt-in: downloads ~35MB on first run) ------------------------------------

test.skipIf(process.env.BISMUTH_LIVE_EMBED !== '1')(
    'live: q8 bge-small embeds, ranks a paraphrase above an unrelated note, and unloads',
    async () => {
        const e = createEmbedder({
            cacheDir: process.env.BISMUTH_LIVE_EMBED_CACHE ?? tempDir('models-'),
            idleMs: 300,
        })
        const rss = () => Math.round(process.memoryUsage.rss() / 1048576)
        const r0 = rss()
        let t = performance.now()
        const [q] = await e.embed(['Represent this sentence for searching relevant passages: how do I make commits look right'])
        const coldMs = Math.round(performance.now() - t)
        const r1 = rss()
        const [near, far] = await e.embed([
            'Commit messages are lowercase, short, and join parts with plus signs.',
            'The tomato plants need watering twice a week in July.',
        ])
        const dot = (a: Float32Array, b: Float32Array) => a.reduce((s, x, i) => s + x * b[i]!, 0)
        expect(dot(q!, near!)).toBeGreaterThan(dot(q!, far!))
        const times: number[] = []
        for (let i = 0; i < 20; i++) {
            t = performance.now()
            await e.embed(['Represent this sentence for searching relevant passages: what does the user prefer'])
            times.push(performance.now() - t)
        }
        times.sort((a, b) => a - b)
        const r2 = rss()
        await sleep(600)
        expect(e.loaded()).toBe(false)
        await sleep(300)
        Bun.gc(true)
        const r3 = rss()
        console.log(JSON.stringify({ coldMs, queryMedianMs: +times[10]!.toFixed(1), rss0: r0, rssLoaded: r1, rssAfterQueries: r2, rssAfterIdleUnload: r3 }))
    },
    120_000,
)

test('a long realistic tool payload still gets semantic scores, from a capped salient query', async () => {
    const { channel, log } = channelWith()
    const svc = recallWith(channel)
    // What the relay sends for a Read: the response object stringified and cut at 2000 chars.
    const body = `# beta plan\n\n${'Saturday morning errands and the beta notes for the week. '.repeat(60)}`
    const path = '/var/folders/7q/zp1x4l2n3b5c6d8f9g0h0000gn/T/memrecall-e2e-b92H/vault/notes/weekend.md'
    const toolCalls = [
        {
            tool_name: 'Read',
            tool_input: { file_path: path },
            tool_response: JSON.stringify({ type: 'text', file: { filePath: path, content: body } }).slice(0, 2000),
        },
    ]
    const call = () => svc.recall({ mode: 'tool', sessionId: `s${Math.random()}`, toolCalls })
    await call() // first call schedules the note embeds
    await sleep(30)
    await channel.stores.get('/mem')!.flush()
    const r = await call()
    expect(r.semantic).toBe(true)
    const queries = log.runs.flat().filter(t => t.startsWith('Represent this'))
    expect(queries.length).toBe(2)
    const q = queries[1]!.slice('Represent this sentence for searching relevant passages: '.length)
    expect(q.length).toBeLessThanOrEqual(1000)
    expect(q.startsWith('weekend')).toBe(true) // the file's name leads, not its temp dir
    expect(q).not.toContain('folders')
    expect(q).not.toContain('b92H')
    channel.embedder()!.dispose()
})

test('a tool call the semantic channel scored says so even when nothing injects', async () => {
    const { channel } = channelWith()
    const svc = recallWith(channel)
    const toolCalls = [{ tool_name: 'Bash', tool_input: { command: 'ls -la' }, tool_response: 'total 0' }]
    await svc.recall({ mode: 'tool', sessionId: 's-a', toolCalls })
    await sleep(30)
    await channel.stores.get('/mem')!.flush()
    await svc.recall({ mode: 'tool', sessionId: 's-b', toolCalls }) // injects the cosine-1 note
    const r = await svc.recall({ mode: 'tool', sessionId: 's-b', toolCalls }) // already shown: nothing
    expect(r.injected).toEqual([])
    expect(r.reason).toBe('no-match')
    expect(r.semantic).toBe(true)
    channel.embedder()!.dispose()
})

// --- no background heat -----------------------------------------------------------------------

test('a failing embedder is tried once per recall, not re-armed in the background', async () => {
    let calls = 0
    const store = createVectorStore(tempDir('vec'), '/mem', {
        embedder: {
            embed: async () => {
                calls++
                throw new Error('boom')
            },
            dispose() {},
        },
        debounceMs: 20,
    })
    store.sync([mkNote('a', 'alpha')])
    await sleep(300)
    expect(calls).toBeLessThanOrEqual(2)
    expect(calls).toBeGreaterThanOrEqual(1)
    const before = calls
    store.sync([mkNote('a', 'alpha')]) // a real recall re-arms exactly one attempt
    await sleep(100)
    expect(calls).toBe(before + 1)
})

test('consecutive load failures back off 30s, 60s, ... capped at an hour', async () => {
    let t = 1_000_000
    let loads = 0
    const e = createEmbedder({
        cacheDir: '/unused',
        now: () => t,
        load: async () => {
            loads++
            throw new Error('offline')
        },
    })
    expect([1, 2, 3, 20].map(backoffFor)).toEqual([30_000, 60_000, 120_000, 3_600_000])
    await expect(e.embed(['a'])).rejects.toThrow('offline') // failure 1: wait 30 s
    t += 29_000
    await expect(e.embed(['a'])).rejects.toThrow('recently')
    t += 2_000
    await expect(e.embed(['a'])).rejects.toThrow('offline') // failure 2: wait 60 s
    t += 31_000
    await expect(e.embed(['a'])).rejects.toThrow('recently')
    t += 30_000
    await expect(e.embed(['a'])).rejects.toThrow('offline')
    expect(loads).toBe(3)
})

test('semantic off stops background re-embedding for good until the next recall', async () => {
    let calls = 0
    const { channel } = channelWith()
    const store = createVectorStore(tempDir('vec'), '/mem', {
        embedder: { embed: async t => (calls++, t.map(() => new Float32Array([1, 0]))), dispose() {} },
        debounceMs: 40,
    })
    channel.stores.set('/mem', store)
    store.sync([mkNote('a', 'alpha')]) // armed
    channel.pause()
    await sleep(150)
    expect(calls).toBe(0)
    channel.embedder()!.dispose()
})

test('a recall with semantic off tells the channel to pause', async () => {
    let off = 0
    const svc = createRecallService({
        memoryDir: () => '/mem',
        settings: () => ({ enabled: true, midTurn: true, semantic: false }),
        embedder: () => null,
        loadNotes: async () => [mkNote('a', 'alpha')],
        semanticOff: () => off++,
    })
    await svc.recall({ mode: 'prompt', sessionId: 's', prompt: 'alpha' })
    expect(off).toBe(1)
})

test('the compiled CLI cannot host the worker: no embedder, BM25 only', () => {
    expect(workerAvailable(false, {}, '/usr/bin/bun')).toBe(true) // dev: bun run embedWorker.ts
    expect(workerAvailable(true, {}, '/app/bismuth-core')).toBe(false) // flag absent
    expect(workerAvailable(true, { BISMUTH_CORE_SIDECAR: '1' }, '/usr/local/bin/bismuth')).toBe(false)
    expect(workerAvailable(true, { BISMUTH_CORE_SIDECAR: '1' }, '/app/bismuth-core')).toBe(true)
    const cli = createSemanticChannel({ compiled: true, env: {}, execPath: '/usr/local/bin/bismuth' })
    expect(cli.embedder()).toBeNull()
    const sidecar = createSemanticChannel({
        compiled: true,
        env: { BISMUTH_CORE_SIDECAR: '1' },
        execPath: '/app/bismuth-core',
    })
    expect(sidecar.embedder()).not.toBeNull()
})
