// The layout worker's entry point: runs one computeLayoutPair per message, off the request thread, and
// posts back `{ id, layout }` or `{ id, error }`. layoutRunner.ts owns the queue, cancellation (it
// terminates this worker) and the in-process fallback. app/scripts/build-core-sidecar.ts passes this file
// as a second `bun build --compile` entrypoint — without that the compiled sidecar has no worker to load.
import { computeLayoutPair, type LayoutJob } from './layoutCompute'

declare const self: Worker
self.onmessage = async (e: MessageEvent<{ id: number; job: LayoutJob }>) => {
    const { id, job } = e.data
    try {
        postMessage({ id, layout: await computeLayoutPair(job) })
    } catch (err) {
        postMessage({ id, error: String((err as Error)?.message ?? err) })
    }
}
