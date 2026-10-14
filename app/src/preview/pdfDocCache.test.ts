// app/src/preview/pdfDocCache.test.ts
// Exercises the PURE refcounted LRU factory (pdfDocCacheCore.ts) only — never the module-scope
// singleton/wiring in pdfDocCache.ts, which pulls in serverVersion (and with it the api/transport
// stack) and isn't meant to load under Bun's test runner.
import { describe, expect, mock, test } from 'bun:test'
import {
    createPdfDocCache,
    createReplacedListeners,
    createSelfWriteGate,
    routePathChange,
    type CachedPdf,
} from './pdfDocCacheCore'

function fakeDoc(): CachedPdf<Record<string, never>> {
    return { doc: {}, destroy: mock(() => {}) }
}

describe('createPdfDocCache', () => {
    test('put then release then acquire is a hit, same value, destroy not called', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        const release = cache.put('a', a)
        release()
        const hit = cache.acquire('a')
        expect(hit?.value).toBe(a)
        expect(a.destroy).not.toHaveBeenCalled()
        hit?.release()
    })

    test('LRU pressure evicts the least recently used unretained entry', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 2 })
        const a = fakeDoc()
        const b = fakeDoc()
        const c = fakeDoc()
        cache.put('a', a)()
        cache.put('b', b)()
        cache.put('c', c)()

        expect(a.destroy).toHaveBeenCalledTimes(1)
        expect(b.destroy).not.toHaveBeenCalled()
        expect(c.destroy).not.toHaveBeenCalled()
        expect(cache.acquire('a')).toBeUndefined()
        const hitB = cache.acquire('b')
        const hitC = cache.acquire('c')
        expect(hitB?.value).toBe(b)
        expect(hitC?.value).toBe(c)
        hitB?.release()
        hitC?.release()
    })

    test('a retained entry survives LRU pressure, then is destroyed on release if still over capacity', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 1 })
        const a = fakeDoc()
        const b = fakeDoc()
        const releaseA = cache.put('a', a) // retained, oldest
        cache.put('b', b) // retained too — the cache now legitimately sits over its max of 1

        // Both are retained, so the cache is allowed to sit over capacity; LRU pressure must
        // not touch either.
        expect(a.destroy).not.toHaveBeenCalled()

        // Releasing A drops it to zero while the cache is still over capacity — destroyed at
        // once rather than left for some later put to clean up.
        releaseA()
        expect(a.destroy).toHaveBeenCalledTimes(1)
    })

    test('invalidate of a retained entry defers destroy until release', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        const release = cache.put('a', a)
        cache.invalidate('a')
        expect(cache.acquire('a')).toBeUndefined()
        expect(a.destroy).not.toHaveBeenCalled()
        release()
        expect(a.destroy).toHaveBeenCalledTimes(1)
        release() // a second release is a no-op, not a double destroy
        expect(a.destroy).toHaveBeenCalledTimes(1)
    })

    test('invalidate of an unretained entry destroys immediately', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        cache.put('a', a)()
        cache.invalidate('a')
        expect(a.destroy).toHaveBeenCalledTimes(1)
        expect(cache.acquire('a')).toBeUndefined()
    })

    test('rename re-keys a live entry; the old handle still releases it', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        const release = cache.put('a', a)
        cache.rename('a', 'b')
        expect(cache.acquire('a')).toBeUndefined()
        const hit = cache.acquire('b')
        expect(hit?.value).toBe(a)
        hit?.release()
        release() // the original put() handle, from before the rename
        expect(a.destroy).not.toHaveBeenCalled() // nothing retains it, but max=3, no pressure
    })

    test('put over an existing key invalidates the old entry and the new one hits', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a1 = fakeDoc()
        const a2 = fakeDoc()
        cache.put('a', a1)()
        const release2 = cache.put('a', a2)
        expect(a1.destroy).toHaveBeenCalledTimes(1) // old entry was unretained -> destroyed at once
        const hit = cache.acquire('a')
        expect(hit?.value).toBe(a2)
        hit?.release()
        release2()
    })

    test('invalidateAll destroys every unretained entry and defers every retained one', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 5 })
        const a = fakeDoc()
        const b = fakeDoc()
        cache.put('a', a)() // unretained
        const releaseB = cache.put('b', b) // retained
        cache.invalidateAll()
        expect(a.destroy).toHaveBeenCalledTimes(1)
        expect(b.destroy).not.toHaveBeenCalled()
        expect(cache.acquire('a')).toBeUndefined()
        expect(cache.acquire('b')).toBeUndefined()
        releaseB()
        expect(b.destroy).toHaveBeenCalledTimes(1)
    })

    test('a release called twice is a no-op the second time', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        const release = cache.put('a', a)
        release()
        release()
        expect(a.destroy).not.toHaveBeenCalled()
        const hit = cache.acquire('a')
        expect(hit?.value).toBe(a)
        hit?.release()
    })
})

describe('revalidateAll', () => {
    test('a path-less change keeps an unchanged doc and drops a changed one', async () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const same = fakeDoc()
        const changed = fakeDoc()
        cache.put('same.pdf', same)()
        cache.put('changed.pdf', changed)()
        await cache.revalidateAll(async key => key === 'same.pdf')
        expect(same.destroy).not.toHaveBeenCalled()
        expect(changed.destroy).toHaveBeenCalledTimes(1)
        const hit = cache.acquire('same.pdf')
        expect(hit?.value).toBe(same)
        hit?.release()
        expect(cache.acquire('changed.pdf')).toBeUndefined()
    })

    test('a check that throws keeps the doc (offline is not a change)', async () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        cache.put('a.pdf', a)()
        await cache.revalidateAll(async () => {
            throw new Error('offline')
        })
        expect(a.destroy).not.toHaveBeenCalled()
        expect(cache.acquire('a.pdf')?.value).toBe(a)
    })

    test('a doc replaced while the check ran is not dropped by the stale verdict', async () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const old = fakeDoc()
        const fresh = fakeDoc()
        cache.put('a.pdf', old)()
        const pending = cache.revalidateAll(async () => {
            cache.put('a.pdf', fresh)()
            return false
        })
        await pending
        expect(fresh.destroy).not.toHaveBeenCalled()
        expect(cache.acquire('a.pdf')?.value).toBe(fresh)
    })

    test('a retained changed doc leaves the map at once and is destroyed on release', async () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const a = fakeDoc()
        const release = cache.put('a.pdf', a)
        await cache.revalidateAll(async () => false)
        expect(cache.acquire('a.pdf')).toBeUndefined()
        expect(a.destroy).not.toHaveBeenCalled()
        release()
        expect(a.destroy).toHaveBeenCalledTimes(1)
    })
})

describe('createSelfWriteGate', () => {
    test('an expected path is consumed once, the change after that is external', () => {
        const gate = createSelfWriteGate()
        gate.expect('a.pdf')
        expect(gate.consume('a.pdf')).toBe(true)
        expect(gate.consume('a.pdf')).toBe(false)
    })

    test('a path nobody expected is never consumed, and paths are independent', () => {
        const gate = createSelfWriteGate()
        gate.expect('a.pdf')
        expect(gate.consume('b.pdf')).toBe(false)
        expect(gate.consume('a.pdf')).toBe(true)
    })

    test('a cancelled path is no longer expected, so the next change is external', () => {
        const gate = createSelfWriteGate()
        gate.expect('a.pdf')
        gate.cancel('a.pdf')
        expect(gate.consume('a.pdf')).toBe(false)
        gate.cancel('never-armed.pdf')
    })

    test('the gate drives the cache: an echo leaves the document, the next change invalidates', () => {
        const cache = createPdfDocCache<Record<string, never>>({ max: 3 })
        const gate = createSelfWriteGate()
        const a = fakeDoc()
        cache.put('a.pdf', a)()
        // the same decision pdfDocCache.ts makes per named path of a server change
        const onChange = (p: string) => {
            if (gate.consume(p)) return
            cache.invalidate(p)
        }
        gate.expect('a.pdf')
        onChange('a.pdf')
        expect(a.destroy).not.toHaveBeenCalled()
        const hit = cache.acquire('a.pdf')
        expect(hit?.value).toBe(a)
        hit?.release()
        onChange('a.pdf')
        expect(a.destroy).toHaveBeenCalledTimes(1)
        expect(cache.acquire('a.pdf')).toBeUndefined()
    })
})

describe('pdf replaced notifications', () => {
    test('a non-self-write change fires the listener; a self-write-consumed one does not; unsubscribe works', () => {
        const bus = createReplacedListeners()
        const gate = createSelfWriteGate()
        const cb = mock(() => {})
        const off = bus.on('a.pdf', cb)
        routePathChange(['a.pdf'], gate, p => bus.fire(p))
        expect(cb).toHaveBeenCalledTimes(1)
        gate.expect('a.pdf')
        routePathChange(['a.pdf'], gate, p => bus.fire(p))
        expect(cb).toHaveBeenCalledTimes(1)
        routePathChange(['b.pdf'], gate, p => bus.fire(p))
        expect(cb).toHaveBeenCalledTimes(1)
        off()
        routePathChange(['a.pdf'], gate, p => bus.fire(p))
        expect(cb).toHaveBeenCalledTimes(1)
    })
})
