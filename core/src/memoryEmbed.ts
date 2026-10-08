import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { noteHash } from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'
import { bismuthHome } from './bismuthHome'
import { EMBED_MODEL } from './embedModel'
import { WORKER_ARG } from './embedWorker'
import type { Embedder, RecallDeps } from './memoryRecall'

/** The semantic channel of recall: a quantized bge-small embedder, loaded lazily and unloaded when
 *  idle, plus a persisted per-memory-dir vector store. The model runs in a CHILD PROCESS
 *  (`embedWorker.ts`) that exits when idle, because only a process exit returns the model's memory to
 *  the OS. THIS FILE MUST NOT STATICALLY IMPORT `@huggingface/transformers` or `onnxruntime-node`:
 *  core boot stays free of the model, the iPad in-process backend never reaches this module, and
 *  `memoryEmbed.test.ts` pins both. */

export { EMBED_MODEL }
/** bge's retrieval instruction: queries only, never documents. */
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '
export const DEFAULT_IDLE_MS = 10 * 60 * 1000
export const QUERY_TIMEOUT_MS = 250
export const REEMBED_DEBOUNCE_MS = 2000
/** Cosines kept per query: rankNotes only reads the top 10, so a bigger map is dead weight. */
export const SCORES_KEPT = 10
/** One embedded window of a note: the model reads ~512 tokens, so a long note is split rather than
 *  truncated, and a note scores as its best window. */
export const CHUNK_CHARS = 600
export const MAX_CHUNKS_PER_NOTE = 40
const BATCH = 1

/** What the pipeline hands back for a batch: a [n, dim] tensor with a flat `data`. */
export type Extractor = {
    /** The backing process id, when there is one (the real child-process extractor). */
    pid?: number
    run(texts: string[]): Promise<{ data: Float32Array; dims: number[] }>
    dispose(): Promise<void> | void
    /** False once the backing process died: the embedder then drops this extractor and respawns. */
    alive?(): boolean
}

export type EmbedderOptions = {
    /** transformers.js model cache (`bismuthHome('models')` in production). */
    cacheDir: string
    idleMs?: number
    /** Test seam: replaces the child-process load. */
    load?: (cacheDir: string) => Promise<Extractor>
    /** Test seam: the child's argv (default: this binary re-executed, or `bun run embedWorker.ts`). */
    workerCommand?: string[]
    /** Give up on a request the child has not answered in this long, and kill it. */
    runTimeoutMs?: number
    /** Test seam: the clock the failure backoff reads. */
    now?: () => number
}

export type LiveEmbedder = Embedder & { loaded(): boolean }

const READY_TIMEOUT_MS = 180_000 // first run downloads the model
const RUN_TIMEOUT_MS = 30_000
export const FAILURE_BACKOFF_MS = 30_000
export const FAILURE_BACKOFF_CAP_MS = 60 * 60 * 1000
/** 30 s, 60 s, 120 s ... capped at 1 h, for the nth consecutive failure (n >= 1). */
export const backoffFor = (consecutive: number) =>
    Math.min(FAILURE_BACKOFF_MS * 2 ** Math.max(0, consecutive - 1), FAILURE_BACKOFF_CAP_MS)

const insideCompiledBinary = () => /\$bunfs|~BUN/.test(import.meta.dir)
/** The compiled `bismuth` CLI also imports server.ts (`bismuth serve`), and re-executing it with the
 *  worker argument prints `unknown command` and exits. Only the core sidecar understands the worker
 *  argument: its launcher (app/src-tauri/src/lib.rs) sets BISMUTH_CORE_SIDECAR=1, and the flag only
 *  counts on a binary named `bismuth-core*`, so a terminal child inheriting the env cannot trip it. */
export function workerAvailable(
    compiled: boolean = insideCompiledBinary(),
    env: Record<string, string | undefined> = process.env,
    execPath: string = process.execPath,
): boolean {
    if (!compiled) return true
    return env.BISMUTH_CORE_SIDECAR === '1' && /^bismuth-core/.test(basename(execPath))
}
const defaultWorkerCommand = () =>
    insideCompiledBinary()
        ? [process.execPath, WORKER_ARG]
        : [process.execPath, 'run', join(import.meta.dir, 'embedWorker.ts'), WORKER_ARG]

const liveChildren = new Set<{ kill(): void }>()
let exitHook = false

/** Spawn the model child and resolve once it reports ready. The returned extractor is a proxy: `run`
 *  sends one request and awaits its reply, `dispose` ends the process (stdin closes, SIGTERM follows,
 *  SIGKILL if that is ignored). A dead child fails every pending request and reports `alive() ===
 *  false`. */
export async function loadWorkerExtractor(
    cacheDir: string,
    o: { command?: string[]; runTimeoutMs?: number; readyTimeoutMs?: number } = {},
): Promise<Extractor> {
    const child = Bun.spawn(o.command ?? defaultWorkerCommand(), {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'inherit',
        env: { ...process.env, BISMUTH_EMBED_CACHE: cacheDir },
    })
    // The child must never keep core alive, and core exiting must never orphan it (stdin closing also
    // ends it; this is the prompt path).
    child.unref()
    liveChildren.add(child)
    if (!exitHook) {
        exitHook = true
        process.on('exit', () => {
            for (const c of liveChildren) c.kill()
        })
    }

    let dead = false
    let deathReason = 'embedding process exited'
    type Pending = { resolve(v: { data: Float32Array; dims: number[] }): void; reject(e: Error): void }
    const pending = new Map<number, Pending>()
    let nextId = 1
    let onReady: { resolve(): void; reject(e: Error): void } | null = null
    const ready = new Promise<void>((resolve, reject) => (onReady = { resolve, reject }))
    ready.catch(() => {})

    const die = (why: string) => {
        if (dead) return
        dead = true
        deathReason = why
        liveChildren.delete(child)
        for (const p of pending.values()) p.reject(new Error(why))
        pending.clear()
        onReady?.reject(new Error(why))
    }
    const terminate = () => {
        try {
            child.stdin.end()
        } catch {}
        child.kill()
        const hard = setTimeout(() => child.kill(9), 2000)
        ;(hard as { unref?: () => void }).unref?.()
        void child.exited.then(() => clearTimeout(hard))
    }
    void child.exited.then(code => die(`embedding process exited (${code})`))

    const onLine = (line: string) => {
        let m: { ready?: boolean; error?: string; id?: number; dims?: number[]; data?: string }
        try {
            m = JSON.parse(line)
        } catch {
            return // stray output on the protocol channel
        }
        if (m.ready === true) return onReady?.resolve()
        if (m.ready === false) return onReady?.reject(new Error(m.error ?? 'embedding model failed to load'))
        const p = pending.get(m.id!)
        if (!p) return
        pending.delete(m.id!)
        if (m.error !== undefined) return p.reject(new Error(m.error))
        const b = Buffer.from(m.data!, 'base64')
        p.resolve({
            data: new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
            dims: m.dims!,
        })
    }
    void (async () => {
        let buf = ''
        const dec = new TextDecoder()
        try {
            const reader = child.stdout.getReader()
            for (;;) {
                const { done, value: chunk } = await reader.read()
                if (done) break
                buf += dec.decode(chunk, { stream: true })
                let nl: number
                while ((nl = buf.indexOf('\n')) >= 0) {
                    onLine(buf.slice(0, nl))
                    buf = buf.slice(nl + 1)
                }
            }
        } catch {}
        die('embedding process closed its output')
    })()

    const readyTimer = setTimeout(() => {
        die('embedding model did not become ready in time')
        terminate()
    }, o.readyTimeoutMs ?? READY_TIMEOUT_MS)
    try {
        await ready
    } catch (err) {
        terminate()
        throw err
    } finally {
        clearTimeout(readyTimer)
    }

    const runTimeoutMs = o.runTimeoutMs ?? RUN_TIMEOUT_MS
    return {
        pid: child.pid,
        alive: () => !dead,
        run(texts) {
            if (dead) return Promise.reject(new Error(deathReason))
            return new Promise((resolve, reject) => {
                const id = nextId++
                const timer = setTimeout(() => {
                    die('embedding process timed out')
                    terminate()
                }, runTimeoutMs)
                const done = <T>(f: (v: T) => void) => (v: T) => {
                    clearTimeout(timer)
                    f(v)
                }
                pending.set(id, { resolve: done(resolve), reject: done(reject) })
                try {
                    child.stdin.write(JSON.stringify({ id, texts }) + '\n')
                    child.stdin.flush()
                } catch (err) {
                    die(String((err as Error).message))
                }
            })
        },
        dispose() {
            die('embedding process disposed')
            terminate()
        },
    }
}

export default function createEmbedder(opts: EmbedderOptions): LiveEmbedder {
    const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    const load =
        opts.load ??
        ((dir: string) =>
            loadWorkerExtractor(dir, { command: opts.workerCommand, runTimeoutMs: opts.runTimeoutMs }))
    let extractor: Extractor | null = null
    let loading: Promise<Extractor> | null = null
    let idle: ReturnType<typeof setTimeout> | null = null
    const now = opts.now ?? Date.now
    let failedAt = 0
    let failures = 0 // consecutive, drives the exponential backoff
    let crashes = 0
    // One embed at a time: ort threads are the machine cost, and nothing here is latency-critical
    // enough to deserve a second concurrent run.
    let chain: Promise<unknown> = Promise.resolve()

    const arm = () => {
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => dispose(), idleMs)
        // A pending idle timer must never keep core alive.
        ;(idle as { unref?: () => void }).unref?.()
    }

    const ensure = async (): Promise<Extractor> => {
        if (extractor) return extractor
        // After a failed load (offline, first run) do not hammer the network on every prompt.
        if (failedAt && now() - failedAt < backoffFor(failures))
            throw new Error('embedder load failed recently')
        loading ??= load(opts.cacheDir).then(
            e => {
                extractor = e
                failedAt = 0
                loading = null
                return e
            },
            err => {
                loading = null
                failedAt = now()
                failures++
                throw err
            },
        )
        return loading
    }

    function dispose() {
        if (idle) clearTimeout(idle)
        idle = null
        const e = extractor
        extractor = null
        if (e) void Promise.resolve(e.dispose()).catch(() => {})
    }

    return {
        loaded: () => extractor !== null,
        dispose,
        embed(texts) {
            const run = async () => {
                const e = await ensure()
                // The idle clock only runs between embeds: a long batch must not be unloaded under itself.
                if (idle) clearTimeout(idle)
                idle = null
                try {
                    const out: Float32Array[] = []
                    for (let i = 0; i < texts.length; i += BATCH) {
                        const { data, dims } = await e.run(texts.slice(i, i + BATCH))
                        const dim = dims[dims.length - 1]!
                        for (let r = 0; r < dims[0]!; r++)
                            out.push(data.slice(r * dim, (r + 1) * dim))
                    }
                    crashes = 0
                    failures = 0
                    failedAt = 0
                    return out
                } catch (err) {
                    // A dead child cannot be reused: forget it so the next request respawns. A second
                    // death in a row is not retried at once, so a child that crashes on load costs one
                    // spawn per backoff window, not one per prompt.
                    if (e.alive?.() === false) {
                        if (extractor === e) extractor = null
                        if (++crashes >= 2) {
                            failedAt = now()
                            failures++
                        }
                    }
                    throw err
                } finally {
                    arm()
                }
            }
            const p = chain.then(run, run)
            chain = p.catch(() => {})
            return p
        },
    }
}

/** The texts embedded for a note: windows of at most `CHUNK_CHARS` chars (breaking on whitespace,
 *  never mid-word unless one word alone exceeds a window), each led by the note's name, description and
 *  tags so a window knows what it belongs to. Capped at `MAX_CHUNKS_PER_NOTE`. Pure. */
export function noteChunks(note: MemoryNote): string[] {
    const fm = note.frontmatter
    const header = [note.name, fm.description, fm.tags.join(' ')].filter(Boolean).join('\n') + '\n'
    const body = note.content
    const size = Math.max(40, CHUNK_CHARS - header.length)
    const out: string[] = []
    let pos = 0
    while (pos < body.length && out.length < MAX_CHUNKS_PER_NOTE) {
        while (pos < body.length && /\s/.test(body[pos]!)) pos++
        if (pos >= body.length) break
        let end = Math.min(pos + size, body.length)
        if (end < body.length && !/\s/.test(body[end]!)) {
            let cut = end
            while (cut > pos && !/\s/.test(body[cut - 1]!)) cut--
            if (cut > pos) end = cut
        }
        const text = body.slice(pos, end).trim()
        if (text) out.push(header + text)
        pos = end
    }
    return out.length ? out : [header.trimEnd()]
}

/** A note scores as its best chunk. */
const bestChunk = (q: Float32Array, s: Stored): number => {
    let best = -Infinity
    for (let o = 0; o + s.dim <= s.vecs.length; o += s.dim) {
        let d = 0
        for (let i = 0; i < s.dim; i++) d += q[i]! * s.vecs[o + i]!
        if (d > best) best = d
    }
    return best
}

export type VectorStoreOptions = {
    embedder: Embedder
    debounceMs?: number
    /** Test seam / metric: called with how many notes one re-embed run covered. */
    onEmbed?: (count: number) => void
}

export type VectorStore = {
    /** Schedule a (debounced) re-embed of every note whose hash changed or that is new. */
    sync(notes: MemoryNote[]): void
    /** Cosine of the query vector against each note's CURRENT vector, top `SCORES_KEPT`. A note whose
     *  vector is stale or missing is absent from the map. Schedules a re-embed for those. */
    scores(queryVec: Float32Array, notes: MemoryNote[]): Promise<Map<string, number>>
    /** Stop background re-embedding until the next sync() (semantic turned off). */
    pause(): void
    /** Run any pending re-embed now and wait for it (tests, measurements). */
    flush(): Promise<void>
}

/** All of a note's chunk vectors, flat: `dim` floats per chunk, concatenated. */
type Stored = { hash: string; dim: number; vecs: Float32Array }

const CHUNKED_FORMAT = 'chunked-v1'

/** Vectors live under `<cacheDir>/<sha1(memoryDir)>/vectors-chunked.json`, so a restart embeds nothing
 *  the last process already had. The older single-vector `vectors.json` beside it belongs to older
 *  builds sharing this cache: it is never read here and never rewritten. */
export function createVectorStore(
    cacheDir: string,
    memoryDir: string,
    opts: VectorStoreOptions,
): VectorStore {
    const dir = join(cacheDir, createHash('sha1').update(memoryDir).digest('hex'))
    const file = join(dir, 'vectors-chunked.json')
    const debounceMs = opts.debounceMs ?? REEMBED_DEBOUNCE_MS
    let entries: Map<string, Stored> | null = null
    let latest: MemoryNote[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    let running: Promise<void> | null = null
    // Set when a run failed or the channel was paused: nothing re-arms until the next real sync()
    // (a recall), so a failing embedder costs one attempt per recall, never a background loop.
    let halted = false

    const read = (): Map<string, Stored> => {
        if (entries) return entries
        entries = new Map()
        try {
            if (existsSync(file)) {
                const j = JSON.parse(readFileSync(file, 'utf8')) as {
                    format?: string
                    model: string
                    vectors: Record<string, { hash: string; dim: number; vecs: string }>
                }
                if (j.format === CHUNKED_FORMAT && j.model === EMBED_MODEL)
                    for (const [name, v] of Object.entries(j.vectors)) {
                        const b = Buffer.from(v.vecs, 'base64')
                        // a zero or ragged dim would make bestChunk loop forever
                        if (!Number.isInteger(v.dim) || v.dim <= 0 || b.byteLength % (4 * v.dim) !== 0)
                            continue
                        entries.set(name, {
                            hash: v.hash,
                            dim: v.dim,
                            vecs: new Float32Array(
                                b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
                            ),
                        })
                    }
            }
        } catch {
            entries = new Map() // a torn or corrupt file just means re-embedding
        }
        return entries
    }

    const persist = () => {
        const vectors: Record<string, { hash: string; dim: number; vecs: string }> = {}
        for (const [name, s] of read())
            vectors[name] = {
                hash: s.hash,
                dim: s.dim,
                vecs: Buffer.from(s.vecs.buffer, s.vecs.byteOffset, s.vecs.byteLength).toString('base64'),
            }
        mkdirSync(dir, { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        writeFileSync(tmp, JSON.stringify({ format: CHUNKED_FORMAT, model: EMBED_MODEL, vectors }))
        renameSync(tmp, file)
    }

    const stale = (notes: MemoryNote[]) => {
        const e = read()
        return notes.filter(n => e.get(n.name)?.hash !== noteHash(n))
    }

    const run = async () => {
        const e = read()
        const notes = latest
        const todo = stale(notes)
        const live = new Set(notes.map(n => n.name))
        let pruned = false
        for (const name of [...e.keys()])
            if (!live.has(name)) {
                e.delete(name)
                pruned = true
            }
        if (todo.length) {
            const chunks = todo.map(noteChunks)
            const vecs = await opts.embedder.embed(chunks.flat())
            let at = 0
            todo.forEach((n, i) => {
                const mine = vecs.slice(at, at + chunks[i]!.length)
                at += mine.length
                const dim = mine[0]!.length
                const flat = new Float32Array(dim * mine.length)
                mine.forEach((v, k) => flat.set(v, k * dim))
                e.set(n.name, { hash: noteHash(n), dim, vecs: flat })
            })
            opts.onEmbed?.(todo.length)
        }
        if (todo.length || pruned) persist()
    }

    const fire = () => {
        timer = null
        running = (running ?? Promise.resolve())
            .then(run)
            .catch(() => {
                halted = true
            })
            .finally(() => {
                running = null
                // Notes that changed while this run was embedding get their own run.
                if (!halted && !timer && stale(latest).length) arm()
            })
    }

    const arm = () => {
        timer = setTimeout(fire, debounceMs)
        ;(timer as { unref?: () => void }).unref?.()
    }

    const sync = (notes: MemoryNote[]) => {
        latest = notes
        halted = false
        // Throttled rather than re-armed per call: a note edited every second still gets embedded.
        // A deleted note arms it too, so its vector is pruned from the file.
        const names = new Set(notes.map(n => n.name))
        const dirty = stale(notes).length > 0 || [...read().keys()].some(k => !names.has(k))
        if (dirty && !timer) arm()
    }

    return {
        sync,
        pause() {
            halted = true
            if (timer) clearTimeout(timer)
            timer = null
        },
        async scores(queryVec, notes) {
            sync(notes)
            const e = read()
            const out: [string, number][] = []
            for (const n of notes) {
                const s = e.get(n.name)
                if (s && s.hash === noteHash(n)) out.push([n.name, bestChunk(queryVec, s)])
            }
            out.sort((a, b) => b[1] - a[1])
            return new Map(out.slice(0, SCORES_KEPT))
        },
        async flush() {
            if (timer) {
                clearTimeout(timer)
                fire()
            }
            while (running) await running
        },
    }
}

export type SemanticChannelOptions = {
    modelsDir?: string
    vectorsDir?: string
    idleMs?: number
    timeoutMs?: number
    debounceMs?: number
    /** Test seam: pretend to run inside a compiled binary / with this env + execPath. */
    compiled?: boolean
    env?: Record<string, string | undefined>
    execPath?: string
    /** Test seam: replaces `createEmbedder`. */
    makeEmbedder?: (o: EmbedderOptions) => LiveEmbedder
    onEmbed?: (count: number) => void
}

export type SemanticChannel = {
    /** null = this binary cannot host the model child (compiled CLI): recall stays BM25. */
    embedder(): LiveEmbedder | null
    /** Semantic is off for a recall: stop every store's background re-embedding. */
    pause(): void
    semanticScores: NonNullable<RecallDeps['semanticScores']>
    stores: Map<string, VectorStore>
}

/** The pieces `createRecallService` takes: ONE lazily-loaded embedder for the process and one vector
 *  store per memory dir. A query past `timeoutMs` (the model loading, or a slow run) or one that
 *  throws yields `undefined`, which recall reads as "BM25 for this request"; the work itself keeps
 *  going in the background, so the next query finds the model warm. */
export function createSemanticChannel(opts: SemanticChannelOptions = {}): SemanticChannel {
    const idleEnv = Number(process.env.BISMUTH_RECALL_IDLE_MS)
    const make = opts.makeEmbedder ?? createEmbedder
    const embedder = make({
        cacheDir: opts.modelsDir ?? bismuthHome('models'),
        idleMs: opts.idleMs ?? (Number.isFinite(idleEnv) && idleEnv > 0 ? idleEnv : DEFAULT_IDLE_MS),
    })
    const vectorsDir = opts.vectorsDir ?? bismuthHome('cache', 'recall')
    const timeoutMs = opts.timeoutMs ?? QUERY_TIMEOUT_MS
    const stores = new Map<string, VectorStore>()
    return {
        embedder: () =>
            opts.makeEmbedder || workerAvailable(opts.compiled, opts.env, opts.execPath)
                ? embedder
                : null,
        pause: () => {
            for (const s of stores.values()) s.pause()
        },
        stores,
        async semanticScores(emb, query, notes, dir) {
            let store = stores.get(dir)
            if (!store) {
                store = createVectorStore(vectorsDir, dir, {
                    embedder: emb,
                    debounceMs: opts.debounceMs,
                    onEmbed: opts.onEmbed,
                })
                stores.set(dir, store)
            }
            store.sync(notes)
            const work = emb
                .embed([QUERY_PREFIX + query])
                .then(([qv]) => store!.scores(qv!, notes))
            work.catch(() => {})
            let timer: ReturnType<typeof setTimeout> | undefined
            const late = new Promise<undefined>(res => {
                timer = setTimeout(() => res(undefined), timeoutMs)
            })
            try {
                return await Promise.race([work, late])
            } finally {
                clearTimeout(timer)
            }
        },
    }
}

let shared: SemanticChannel | null = null
/** The process-wide channel, created on first use so core boot allocates nothing. */
export function sharedSemanticChannel(): SemanticChannel {
    return (shared ??= createSemanticChannel())
}
