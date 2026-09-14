// serverVersion.ts owns the whole "backend said something changed -> the app refetches" chain,
// and until `start()` existed it had ZERO runtime coverage: it built an EventSource and an
// interval at MODULE SCOPE, so importing it headlessly both threw (bun has no global
// EventSource) and leaked a live timer into every later test in the process. Two real bugs
// shipped through that gap (github issues #3 and #8).
//
// These tests drive the module with a fake EventSource and a fake poll, so the chain is exercised
// without any network, any real timer, or any module-load side effect.
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'

// A minimal stand-in for the browser EventSource, so a test can emit frames on demand.
class FakeEventSource {
    static instances: FakeEventSource[] = []
    onopen: (() => void) | null = null
    onmessage: ((e: { data: string }) => void) | null = null
    onerror: ((e: unknown) => void) | null = null
    closed = false
    constructor(public url: string) {
        FakeEventSource.instances.push(this)
    }
    close() {
        this.closed = true
    }
    /** Test helper: pretend the server pushed a frame. */
    emit(payload: unknown) {
        this.onmessage?.({ data: JSON.stringify(payload) })
    }
}

let dispose: (() => void) | undefined

beforeEach(() => {
    FakeEventSource.instances = []
})
afterEach(() => {
    dispose?.()
    dispose = undefined
})

// A manually-advanced clock for `setTimeoutFn`/`clearTimeoutFn`, so the boot-retry backoff can be
// exercised without any real waiting. `advance(ms)` moves the virtual clock forward and fires every
// timer whose deadline has now passed (in deadline order), same as a real event loop would.
function makeFakeClock() {
    let now = 0
    const timers: { id: number; at: number; fn: () => void }[] = []
    let nextId = 1
    return {
        setTimeoutFn: (fn: () => void, ms: number) => {
            const id = nextId++
            timers.push({ id, at: now + ms, fn })
            return id as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeoutFn: (h: ReturnType<typeof setTimeout>) => {
            const idx = timers.findIndex(t => t.id === (h as unknown as number))
            if (idx >= 0) timers.splice(idx, 1)
        },
        advance(ms: number) {
            now += ms
            for (const t of [...timers].sort((a, b) => a.at - b.at)) {
                if (t.at > now) continue
                const idx = timers.indexOf(t)
                if (idx >= 0) timers.splice(idx, 1)
                t.fn()
            }
        },
    }
}

describe('serverVersion start()', () => {
    it('does NOT touch the network or timers until start() is called', async () => {
        const mod = await import('./serverVersion')
        // Importing alone must create nothing — this is the property that makes the module testable.
        expect(FakeEventSource.instances.length).toBe(0)
        expect(mod.serverVersion()).toBe(0)
    })

    it('an SSE frame updates lastChange and notifies imperative subscribers', async () => {
        const mod = await import('./serverVersion')
        const seen: unknown[] = []
        const off = mod.onServerChange(c => seen.push(c))
        dispose = mod.start({
            eventSourceFactory: url =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
        })

        const es = FakeEventSource.instances[0]!
        es.onopen?.()
        es.emit({
            version: 7,
            paths: ['Note.md'],
            dirty: { graph: false, tree: true },
        })

        expect(mod.serverVersion()).toBe(7)
        expect(mod.lastChange().paths).toEqual(['Note.md'])
        expect(mod.lastChange().dirty).toEqual({ graph: false, tree: true })
        expect(seen.length).toBe(1)
        off()
    })

    it('a malformed frame is ignored rather than crashing the stream', async () => {
        const mod = await import('./serverVersion')
        dispose = mod.start({
            eventSourceFactory: url =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
        })
        const es = FakeEventSource.instances[0]!
        const before = mod.serverVersion()
        es.onmessage?.({ data: '{not json' })
        es.emit({ paths: [] }) // no version field
        expect(mod.serverVersion()).toBe(before)
    })

    it('start() is idempotent — a second call does not open a second stream or a second poll', async () => {
        const mod = await import('./serverVersion')
        // `createEventSource()` already no-ops once `es` is non-null, so an assertion on
        // instance count alone would still pass even if the `started` guard in `start()` itself were
        // deleted — it wouldn't be discriminating what it claims to. Counting `setIntervalFn` calls
        // closes that hole: `startPolling()` has no such secondary guard of its own, so a missing
        // `started` check would re-run it (and this count) on every extra `start()` call.
        let intervalCalls = 0
        const deps = {
            eventSourceFactory: (url: string) =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => {
                intervalCalls++
                return 0 as unknown as ReturnType<typeof setInterval>
            },
            clearIntervalFn: () => {},
        }
        dispose = mod.start(deps)
        const callsAfterFirstStart = intervalCalls
        mod.start(deps)
        expect(FakeEventSource.instances.length).toBe(1)
        expect(intervalCalls).toBe(callsAfterFirstStart)
    })

    it('the disposer closes the stream and clears the poll', async () => {
        const mod = await import('./serverVersion')
        let cleared = 0
        const d = mod.start({
            eventSourceFactory: url =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () =>
                123 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {
                cleared++
            },
        })
        d()
        expect(FakeEventSource.instances[0]!.closed).toBe(true)
        expect(cleared).toBeGreaterThan(0)
        dispose = undefined
    })

    it('an SSE error before the first successful open retries at a FLAT 250ms interval, not backing off (controller ruling 2026-09-13)', async () => {
        const mod = await import('./serverVersion')
        const clock = makeFakeClock()
        dispose = mod.start({
            eventSourceFactory: url =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
            setTimeoutFn: clock.setTimeoutFn,
            clearTimeoutFn: clock.clearTimeoutFn,
        })

        // Without the boot-retry fix at all, nothing retries the EventSource until the poll drops
        // to its 1s disconnected interval.
        FakeEventSource.instances[0]!.onerror?.(new Event('error'))
        expect(FakeEventSource.instances.length).toBe(1)

        // Attempt 2 at cumulative 250ms — not a moment before.
        clock.advance(249)
        expect(FakeEventSource.instances.length).toBe(1)
        clock.advance(1)
        expect(FakeEventSource.instances.length).toBe(2)
        FakeEventSource.instances[1]!.onerror?.(new Event('error'))

        // Attempt 3 at cumulative 500ms. A BACKED-OFF schedule (e.g. doubling to 500ms between
        // attempt 2 and 3) would still show only 2 instances here — this is the assertion that
        // fails against a backoff implementation and is why each step is checked, not just the
        // final one.
        clock.advance(249)
        expect(FakeEventSource.instances.length).toBe(2)
        clock.advance(1)
        expect(FakeEventSource.instances.length).toBe(3)
        FakeEventSource.instances[2]!.onerror?.(new Event('error'))

        // Attempt 4 at cumulative 750ms.
        clock.advance(249)
        expect(FakeEventSource.instances.length).toBe(3)
        clock.advance(1)
        expect(FakeEventSource.instances.length).toBe(4)
    })

    it('after the stream has opened once, a later error does not use the fast boot retry', async () => {
        const mod = await import('./serverVersion')
        const clock = makeFakeClock()
        dispose = mod.start({
            eventSourceFactory: url =>
                new FakeEventSource(url) as unknown as EventSource,
            fetchVersion: async () => ({ version: 0 }),
            setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
            clearIntervalFn: () => {},
            setTimeoutFn: clock.setTimeoutFn,
            clearTimeoutFn: clock.clearTimeoutFn,
        })

        const first = FakeEventSource.instances[0]!
        first.onopen?.()
        first.onerror?.(new Event('error'))
        // Advance well past any boot-retry window — a missing `sseEverOpened` guard would open a
        // second EventSource here via the fast path; the only reconnect this scenario should ever
        // get is the pre-existing poll-driven one, which this fake poll (setIntervalFn returning a
        // dummy handle, never actually invoked by `advance`) never fires either.
        clock.advance(10000)
        expect(FakeEventSource.instances.length).toBe(1)
    })
})
