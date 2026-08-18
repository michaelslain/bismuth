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
})
