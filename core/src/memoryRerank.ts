import { join } from 'node:path'
import { bismuthHome } from './bismuthHome'
import { DEFAULT_IDLE_MS, backoffFor, loadWorkerExtractor, workerAvailable } from './memoryEmbed'
import type { Extractor } from './memoryEmbed'
import { RERANK_MODEL, RERANK_WORKER_ARG } from './rerankWorker'

/** The cross-encoder behind recall's relevance gate: ms-marco MiniLM in its own idle-exiting child
 *  process (the embedder's pattern: lazy, failure backoff, `workerAvailable()` gate). THIS FILE MUST
 *  NOT STATICALLY IMPORT THE MODEL PACKAGES; `memoryEmbed.test.ts` pins core boot's import graph. */

export { RERANK_MODEL, RERANK_WORKER_ARG }
/** A slower answer means today's rules for that request (the load/run keeps going in the background). */
export const RERANK_TIMEOUT_MS = 700
const RERANK_RUN_TIMEOUT_MS = 30_000

export type Reranker = {
    /** One raw logit per passage, same order. Rejects on failure. */
    rerank(query: string, passages: string[]): Promise<number[]>
    dispose(): void
}

export type RerankerOptions = {
    /** transformers.js model cache (`bismuthHome('models')` in production). */
    cacheDir: string
    idleMs?: number
    /** Test seam: replaces the child-process load. */
    load?: (cacheDir: string) => Promise<Extractor>
    /** Test seam: the child's argv (default: this binary re-executed, or `bun run rerankWorker.ts`). */
    workerCommand?: string[]
    runTimeoutMs?: number
    /** Test seam: the clock the failure backoff reads. */
    now?: () => number
}

const insideCompiledBinary = () => /\$bunfs|~BUN/.test(import.meta.dir)
const defaultWorkerCommand = () =>
    insideCompiledBinary()
        ? [process.execPath, RERANK_WORKER_ARG]
        : [process.execPath, 'run', join(import.meta.dir, 'rerankWorker.ts'), RERANK_WORKER_ARG]

export default function createReranker(opts: RerankerOptions): Reranker {
    const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS
    const load =
        opts.load ??
        ((dir: string) =>
            loadWorkerExtractor(dir, {
                command: opts.workerCommand ?? defaultWorkerCommand(),
                runTimeoutMs: opts.runTimeoutMs ?? RERANK_RUN_TIMEOUT_MS,
            }))
    const now = opts.now ?? Date.now
    let extractor: Extractor | null = null
    let loading: Promise<Extractor> | null = null
    let idle: ReturnType<typeof setTimeout> | null = null
    let failedAt = 0
    let failures = 0
    let crashes = 0
    // One request at a time: the ort threads are the machine cost.
    let chain: Promise<unknown> = Promise.resolve()

    const arm = () => {
        if (idle) clearTimeout(idle)
        idle = setTimeout(() => dispose(), idleMs)
        ;(idle as { unref?: () => void }).unref?.()
    }

    const ensure = async (): Promise<Extractor> => {
        if (extractor) return extractor
        if (failedAt && now() - failedAt < backoffFor(failures))
            throw new Error('reranker load failed recently')
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
        dispose,
        rerank(query, passages) {
            if (!passages.length) return Promise.resolve([])
            const run = async () => {
                const e = await ensure()
                if (idle) clearTimeout(idle)
                idle = null
                try {
                    const { data, dims } = await e.run([query, ...passages])
                    if (data.length !== passages.length || dims[0] !== passages.length)
                        throw new Error('reranker returned an unexpected shape')
                    crashes = 0
                    failures = 0
                    failedAt = 0
                    return Array.from(data)
                } catch (err) {
                    // A dead child is forgotten so the next request respawns; two deaths in a row back off.
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

let shared: Reranker | null = null
/** The process-wide reranker, created on first use so core boot allocates nothing. null where the
 *  child cannot run (the compiled CLI), exactly like the embedder: recall keeps today's rules. */
export function sharedReranker(): Reranker | null {
    if (!workerAvailable()) return null
    const idleEnv = Number(process.env.BISMUTH_RECALL_IDLE_MS)
    return (shared ??= createReranker({
        cacheDir: bismuthHome('models'),
        idleMs: Number.isFinite(idleEnv) && idleEnv > 0 ? idleEnv : DEFAULT_IDLE_MS,
    }))
}
