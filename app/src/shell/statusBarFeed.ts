import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { StatusSegment } from '../../../core/src/statusBarEval'

export type StatusBarFeedDeps = {
    fetch: () => Promise<StatusSegment[]>
    version: () => number // serverVersion
    config: () => unknown // settings.statusBar: refetch when it changes
    setInterval?: typeof setInterval
    clearInterval?: typeof clearInterval
}

const MAX_INTERVAL_S = 60

/** Poll interval in ms, or null when no run/untrusted segment needs polling. */
export function nextRefreshMs(segments: StatusSegment[] | undefined): number | null {
    if (!segments) return null
    let best: number | null = null
    for (const s of segments) {
        if (s.every === undefined && !s.untrusted) continue
        const secs = Math.min(s.every ?? MAX_INTERVAL_S, MAX_INTERVAL_S)
        if (best === null || secs < best) best = secs
    }
    return best === null ? null : Math.max(1, best) * 1000
}

/** Coalescing fetcher: one in flight, at most one queued behind it. A failure keeps the last
 *  good value (onResult is simply not called). */
export function createRefetcher<T>(
    fetch: () => Promise<T>,
    onResult: (value: T) => void,
): () => void {
    let inFlight = false
    let queued = false
    const run = () => {
        if (inFlight) {
            queued = true
            return
        }
        inFlight = true
        fetch()
            .then(onResult, () => {})
            .finally(() => {
                inFlight = false
                if (queued) {
                    queued = false
                    run()
                }
            })
    }
    return run
}

export function createStatusBarFeed(deps: StatusBarFeedDeps): {
    segments: () => StatusSegment[] | undefined
    refresh: () => void
} {
    const [segments, setSegments] = createSignal<StatusSegment[] | undefined>(undefined)
    const refresh = createRefetcher(deps.fetch, setSegments)
    // fires on mount (defer: false) and whenever the server version or the config moves
    createEffect(on([deps.version, deps.config], () => refresh()))
    createEffect(() => {
        const ms = nextRefreshMs(segments())
        if (ms === null) return
        const id = (deps.setInterval ?? setInterval)(refresh, ms)
        onCleanup(() => (deps.clearInterval ?? clearInterval)(id))
    })
    return { segments, refresh }
}
