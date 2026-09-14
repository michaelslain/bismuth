import { test, expect } from 'bun:test'
import { createAsyncCache } from '../src/asyncCache'

/** A promise whose resolution we drive by hand, to control build timing in tests. */
function deferred<T>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

test('get() dedupes concurrent builds into one', async () => {
    let builds = 0
    const d = deferred<number>()
    const cache = createAsyncCache(() => {
        builds++
        return d.promise
    })

    const a = cache.get()
    const b = cache.get()
    d.resolve(42)

    expect(await a).toBe(42)
    expect(await b).toBe(42)
    expect(builds).toBe(1)
})

test('caches the result; later get() does not rebuild', async () => {
    let builds = 0
    const cache = createAsyncCache(async () => {
        builds++
        return 'v'
    })

    expect(await cache.get()).toBe('v')
    expect(cache.peek()).toBe('v')
    expect(await cache.get()).toBe('v')
    expect(builds).toBe(1)
})

test('invalidate() after a cached value forces a rebuild', async () => {
    let builds = 0
    const cache = createAsyncCache(async () => {
        builds++
        return builds
    })

    expect(await cache.get()).toBe(1)
    cache.invalidate()
    expect(cache.peek()).toBeNull()
    expect(await cache.get()).toBe(2)
    expect(builds).toBe(2)
})

test("invalidate() during an in-flight build drops that build's result", async () => {
    let builds = 0
    const first = deferred<string>()
    const second = deferred<string>()
    const cache = createAsyncCache(() => {
        builds++
        return builds === 1 ? first.promise : second.promise
    })

    const p = cache.get() // starts build #1
    cache.invalidate() // invalidated while build #1 is still pending
    first.resolve('stale')
    // The awaiting caller must NOT be handed the value we already know is stale:
    // it re-builds and resolves with the fresh one instead. (A GET /tree that
    // resolved to "stale" here is exactly how a deleted folder stayed on screen.)
    second.resolve('fresh')
    expect(await p).toBe('fresh')
    expect(cache.peek()).toBe('fresh')
    expect(builds).toBe(2)
})

// The gap the test above did not cover: the second get() arrives while the
// invalidated build is STILL in flight, so it hits the `inFlight` dedupe branch
// and gets handed a snapshot taken BEFORE the mutation it is refetching for.
// This is the file-tree bug — applyDirty() invalidates and publishes SSE in the
// same tick, so the client's refetch lands squarely inside this window.
// Builds are serialized (see the concurrency test below), so build #2 is not even
// INVOKED until #1 settles — hence these drive timed builds rather than deferreds a
// test could resolve out of order.
test('get() after invalidate() never adopts a build that predates it', async () => {
    const values = ['PRE-DELETE', 'POST-DELETE']
    let builds = 0
    const cache = createAsyncCache(async () => {
        const v = values[Math.min(builds++, values.length - 1)]
        await new Promise(r => setTimeout(r, 5))
        return v
    })

    const p1 = cache.get() // build #1: the vault as it was BEFORE the delete
    cache.invalidate() // the delete lands -> applyDirty invalidates
    const p2 = cache.get() // the client's SSE-driven refetch, mid-build-#1

    expect(await p2).toBe('POST-DELETE') // the refetch must see the delete
    expect(await p1).toBe('POST-DELETE') // the original awaiter converges too
    expect(cache.peek()).toBe('POST-DELETE')
    expect(builds).toBe(2) // a fresh build ran; #1 was not reused
})

// Repeated invalidation must still converge rather than chaining rebuilds forever.
test('back-to-back invalidations settle on the last build', async () => {
    let builds = 0
    const cache = createAsyncCache(async () => {
        const n = ++builds
        await new Promise(r => setTimeout(r, 3))
        return `v${n}`
    })

    const p = cache.get()
    cache.invalidate()
    const mid = cache.get()
    cache.invalidate()
    const last = cache.get()

    const settled = await last
    expect(settled).toBe(`v${builds}`) // the newest build wins
    expect(await p).toBe(settled) // every awaiter converges on it
    expect(await mid).toBe(settled)
    expect(cache.peek()).toBe(settled)
})

test('a rejected build clears in-flight so the next get() retries', async () => {
    let builds = 0
    const cache = createAsyncCache(async () => {
        builds++
        if (builds === 1) throw new Error('boom')
        return 'ok'
    })

    await expect(cache.get()).rejects.toThrow('boom')
    expect(await cache.get()).toBe('ok')
    expect(builds).toBe(2)
})

test('warm() populates the cache without throwing', async () => {
    let builds = 0
    const cache = createAsyncCache(async () => {
        builds++
        return 'warmed'
    })
    cache.warm()
    // Builds are queued behind `tail`, so warm() starts one a microtask later than it
    // used to — yield a full macrotask rather than counting microtask hops.
    await new Promise(r => setTimeout(r, 0))
    expect(cache.peek()).toBe('warmed')
    expect(builds).toBe(1)
})

test('warm() swallows build errors', async () => {
    const cache = createAsyncCache(async () => {
        throw new Error('nope')
    })
    expect(() => cache.warm()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(cache.peek()).toBeNull()
})

// invalidate() clears `inFlight` so a post-mutation get() never reuses a pre-mutation
// build. That alone would let an invalidation storm start N concurrent full rebuilds
// (the graph build is seconds of CPU), so builds are serialized: one runs, one waits.
test('concurrent rebuilds are serialized — never two builds running at once', async () => {
    let running = 0
    let peak = 0
    let builds = 0
    const cache = createAsyncCache(async () => {
        running++
        peak = Math.max(peak, running)
        const n = ++builds
        await new Promise(r => setTimeout(r, 10))
        running--
        return `v${n}`
    })

    // Five invalidate-then-read cycles, each landing well inside the previous build.
    const reads: Promise<string>[] = []
    for (let i = 0; i < 5; i++) {
        cache.invalidate()
        reads.push(cache.get())
        await new Promise(r => setTimeout(r, 1))
    }
    await Promise.all(reads)

    expect(builds).toBeGreaterThan(1) // rebuilds really did happen (not a vacuous pass)
    expect(peak).toBe(1) // ...but never two full rebuilds at once
})

// ── Cancellation: invalidate() aborts the stale build instead of letting it run to completion ──

test('invalidate() aborts the in-flight build and the next get() does not wait for it', async () => {
    let aborted = false
    let builds = 0
    const cache = createAsyncCache<number>(signal => {
        builds++
        if (builds === 1)
            return new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    aborted = true
                    reject(
                        Object.assign(new Error('aborted'), {
                            name: 'AbortError',
                        }),
                    )
                })
            })
        return Promise.resolve(2)
    })
    const first = cache.get()
    cache.invalidate()
    expect(aborted).toBe(true)
    expect(await first).toBe(2)
    expect(await cache.get()).toBe(2)
})

// A build still QUEUED behind a running one when invalidate() lands is stale before it starts: it must
// never be invoked at all (the graph build does seconds of vault I/O before it could notice a signal).
test('a queued build that was invalidated before it started is never invoked', async () => {
    const started: number[] = []
    let builds = 0
    const gate = deferred<void>()
    const cache = createAsyncCache<number>(async () => {
        const n = ++builds
        started.push(n)
        if (n === 1) await gate.promise
        return n
    })
    const p1 = cache.get() // build #1 runs, held open by the gate
    cache.invalidate()
    const p2 = cache.get() // build #2 queues behind #1
    cache.invalidate() // #2 is stale before it ever ran
    const p3 = cache.get() // build #3 queues behind #2
    gate.resolve()
    expect(await p3).toBe(2)
    expect(await p1).toBe(2)
    expect(await p2).toBe(2)
    expect(started).toEqual([1, 2]) // #1 ran, #2 is the fresh build; the doomed queued one never ran
})

// Only an INVALIDATED build's AbortError is swallowed. An abort the cache did not ask for is a real
// failure and must reach the caller rather than silently retrying.
test('an AbortError from a build that was not invalidated reaches the caller', async () => {
    let builds = 0
    const cache = createAsyncCache<number>(async () => {
        // Only the first build aborts: a cache that wrongly retried it would resolve with 7 — a clean
        // red — rather than retrying an always-aborting build forever and hanging the run.
        if (++builds === 1)
            throw Object.assign(new Error('gone'), { name: 'AbortError' })
        return 7
    })
    await expect(cache.get()).rejects.toMatchObject({ name: 'AbortError' })
    expect(builds).toBe(1)
})
