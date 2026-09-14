// app/src/inflight.ts
// Dedupe concurrent calls to an async function so a burst of callers (a mount effect + an SSE
// effect firing in the same tick, say) share ONE in-flight request instead of each starting its
// own. A call made after the in-flight one has settled (resolved or rejected) starts a fresh one —
// this is a request-coalescer, not a cache.
export function dedupeInflight<T>(fn: () => Promise<T>): () => Promise<T> {
    let inflight: Promise<T> | null = null
    return () => {
        if (inflight) return inflight
        inflight = fn().finally(() => {
            inflight = null
        })
        return inflight
    }
}
