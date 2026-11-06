// app/src/bases/transcribeQueue.ts
// A one-at-a-time queue for page transcription: the book adds a file per dropped page and the
// queue runs them in order through an injected `run`, so the transcriber never sees two requests
// at once. Signal-free (the book view subscribes and re-reads `snapshot()`), so it stays testable.
import type { TranscribeEngine } from '../../../core/src/transcript'

/** One queued run: `engine` unset for automatic and button runs; `pages` set to redo only those;
 *  `math` how auto treats a page that looks like math. */
export type TranscribeJob = { engine?: TranscribeEngine; pages?: number[]; math?: 'careful' | 'fast' }
/** `done` and `total` count pages (a job without `pages` is one); `runningCount` is the pages of the job in progress. */
export type TranscribeSnapshot = { done: number; total: number; running?: string; runningCount: number }
export type TranscribeQueue = {
    add(file: string, job?: TranscribeJob): void
    snapshot(): TranscribeSnapshot
    subscribe(fn: () => void): () => void
}

const pageCount = (job: TranscribeJob) => job.pages?.length ?? 1

export function createTranscribeQueue(
    run: (file: string, job: TranscribeJob) => Promise<unknown>,
): TranscribeQueue {
    const waiting: { file: string; job: TranscribeJob }[] = []
    const listeners = new Set<() => void>()
    let done = 0
    let total = 0
    let running: string | undefined
    let runningCount = 0
    let busy = false

    const notify = () => listeners.forEach(fn => fn())

    async function pump() {
        if (busy) return
        busy = true
        while (waiting.length) {
            const next = waiting.shift()!
            running = next.file
            runningCount = pageCount(next.job)
            notify()
            try {
                await run(next.file, next.job)
            } catch {
                // a failed page counts as done: the queue keeps going
            }
            done += pageCount(next.job)
            running = undefined
            runningCount = 0
            notify()
        }
        busy = false
        // a drained queue starts its next batch from zero
        done = 0
        total = 0
        notify()
    }

    return {
        add(file, job = {}) {
            if (running === file || waiting.some(w => w.file === file)) return
            waiting.push({ file, job })
            total += pageCount(job)
            notify()
            void pump()
        },
        snapshot: () => ({ done, total, running, runningCount }),
        subscribe(fn) {
            listeners.add(fn)
            return () => listeners.delete(fn)
        },
    }
}
