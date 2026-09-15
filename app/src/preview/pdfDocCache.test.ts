// app/src/preview/pdfDocCache.test.ts
// Exercises the PURE refcounted LRU factory (pdfDocCacheCore.ts) only — never the module-scope
// singleton/wiring in pdfDocCache.ts, which pulls in serverVersion (and with it the api/transport
// stack) and isn't meant to load under Bun's test runner.
import { describe, expect, mock, test } from 'bun:test'
import { createPdfDocCache, type CachedPdf } from './pdfDocCacheCore'

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
