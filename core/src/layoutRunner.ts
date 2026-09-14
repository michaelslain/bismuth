// Where a layout job runs. A full settle holds a thread for 10–20 s on a real vault, and on the request
// thread that starved everything else even while yielding every 8 ms (listTree took 20–28 s at boot,
// saves went 2.7 ms → 145 ms). So jobs run in ONE persistent Bun Worker (layoutWorker.ts), created on the
// first job, fed FIFO, one job at a time. The worker runs the very same computeLayoutPair, so the output
// is byte-identical to the in-process path.
//
// Cancellation: aborting the RUNNING job terminates the worker and rejects the job with the signal's
// reason — an AbortError for a plain abort(), which is what asyncCache.ts and layout-cache.ts's joinBuild
// read as "superseded". The next queued job gets a fresh worker. Aborting a QUEUED job just drops it.
//
// In-process fallback (computeLayoutPair on this thread, as before): no Bun at all (the mobile in-process
// backend, localBackend.ts, runs this module inside a WKWebView); BISMUTH_LAYOUT_IN_PROCESS=1; or a worker
// that cannot be used. Bun does NOT throw from `new Worker` for a worker file that is missing — e.g. a
// `bun build --compile` that did not list layoutWorker.ts as an entrypoint — it fires `error` and `close`
// afterwards, so those events fall back too (and settle every job already handed to the worker) rather
// than leaving the jobs pending forever. Either way it is logged once and every later job runs in-process.
import { computeLayoutPair, type LayoutJob } from './layoutCompute'
import type { Layout } from './layoutDiff'

type Entry = {
    id: number
    job: LayoutJob
    signal?: AbortSignal
    onAbort?: () => void
    resolve: (layout: Layout) => void
    reject: (err: unknown) => void
}

type Reply = { id: number; layout?: Layout; error?: string }

// core's tsconfig loads lib.dom, so the global `Worker` type is the DOM one; Bun's Worker also has these.
type BunWorker = Worker & { ref(): void; unref(): void }

export type LayoutRunner = {
    run(job: LayoutJob, signal?: AbortSignal): Promise<Layout>
}

const messageOf = (err: unknown): string =>
    String((err as Error)?.message ?? err)

/** A worker-backed runner over the worker script at `workerUrl`. Production uses the one instance behind
 *  `runLayoutJob`; tests build their own to point it at a worker that does not exist. */
export function createLayoutRunner(workerUrl: string): LayoutRunner {
    const queue: Entry[] = []
    let running: Entry | null = null
    let worker: BunWorker | null = null
    let unavailable = false
    let nextId = 0

    const detach = (entry: Entry) => {
        if (entry.onAbort)
            entry.signal?.removeEventListener('abort', entry.onAbort)
    }

    const inProcess = (entry: Entry) => {
        detach(entry)
        computeLayoutPair(entry.job, entry.signal).then(
            entry.resolve,
            entry.reject,
        )
    }

    // The worker is unusable: log once, and run everything it held — and every later job — in-process.
    const fallBack = (message: string) => {
        if (!unavailable)
            console.warn(
                `[layout] worker unavailable, computing in-process: ${message}`,
            )
        unavailable = true
        const dead = worker
        worker = null
        dead?.terminate()
        const held = running ? [running, ...queue] : [...queue]
        running = null
        queue.length = 0
        for (const entry of held) inProcess(entry)
    }

    const spawn = (): BunWorker => {
        const w = new Worker(workerUrl) as BunWorker
        // Every handler checks it still belongs to the CURRENT worker: a terminated one can still deliver
        // a late event, and must never settle a job the next worker is running.
        w.onmessage = (e: MessageEvent<Reply>) => {
            if (w === worker) onReply(e.data)
        }
        w.addEventListener('error', e => {
            if (w === worker) fallBack(e.message)
        })
        w.addEventListener('close', () => {
            if (w === worker) fallBack('the layout worker exited')
        })
        return w
    }

    const pump = () => {
        if (unavailable || running) return
        const next = queue.shift()
        if (!next) {
            // Idle: never hold the process open (a one-shot script, the test runner) for a worker with
            // nothing to do. It is ref'd again below while a job runs, so a pending job keeps it alive.
            worker?.unref()
            return
        }
        running = next
        if (!worker) {
            try {
                worker = spawn()
            } catch (err) {
                fallBack(messageOf(err))
                return
            }
        }
        worker.ref()
        try {
            worker.postMessage({ id: next.id, job: next.job })
        } catch (err) {
            // The job itself could not be sent (not structured-cloneable); the worker is fine.
            running = null
            detach(next)
            next.reject(err)
            pump()
        }
    }

    const onReply = (reply: Reply) => {
        const entry = running
        if (!entry || entry.id !== reply.id) return
        running = null
        detach(entry)
        if (reply.error !== undefined) entry.reject(new Error(reply.error))
        else entry.resolve(reply.layout as Layout)
        pump()
    }

    const abort = (entry: Entry) => {
        const reason = entry.signal?.reason
        if (entry === running) {
            const doomed = worker
            worker = null
            running = null
            doomed?.terminate()
            entry.reject(reason)
            pump() // a fresh worker for the next queued job
            return
        }
        const i = queue.indexOf(entry)
        if (i >= 0) queue.splice(i, 1)
        entry.reject(reason)
    }

    return {
        run(job, signal) {
            if (signal?.aborted) return Promise.reject(signal.reason)
            if (unavailable) return computeLayoutPair(job, signal)
            return new Promise<Layout>((resolve, reject) => {
                const entry: Entry = {
                    id: nextId++,
                    job,
                    signal,
                    resolve,
                    reject,
                }
                if (signal) {
                    entry.onAbort = () => abort(entry)
                    signal.addEventListener('abort', entry.onAbort, {
                        once: true,
                    })
                }
                queue.push(entry)
                pump()
            })
        },
    }
}

let defaultRunner: LayoutRunner | null = null

/**
 * Run one layout job off the request thread and resolve its layout — byte-identical to
 * `computeLayoutPair(job)`. Aborting `signal` rejects with the signal's reason (an AbortError for a plain
 * `abort()`) and stops the compute. Computes in-process instead when there is no Bun (mobile), when
 * `BISMUTH_LAYOUT_IN_PROCESS=1`, or once the worker has proved unusable (see the header).
 */
export function runLayoutJob(
    job: LayoutJob,
    signal?: AbortSignal,
): Promise<Layout> {
    if (
        typeof Bun === 'undefined' ||
        process.env.BISMUTH_LAYOUT_IN_PROCESS === '1'
    )
        return computeLayoutPair(job, signal)
    defaultRunner ??= createLayoutRunner(
        // .js not .ts: the compiled sidecar embeds the worker only as /$bunfs/root/layoutWorker.js; dev + tests resolve .js to the .ts source
        new URL('./layoutWorker.js', import.meta.url).href,
    )
    return defaultRunner.run(job, signal)
}
