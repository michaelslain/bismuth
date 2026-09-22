import { describe, expect, it } from 'bun:test'
import { RowCache } from './rowCache'

describe('RowCache', () => {
    it('peek returns the last set value', () => {
        const c = new RowCache<number>()
        expect(c.peek('a')).toBeUndefined()
        c.set('a', 1, 10)
        expect(c.peek('a')).toBe(1)
    })

    it('isFresh is true only for the version it was set at', () => {
        const c = new RowCache<number>()
        c.set('a', 1, 10)
        expect(c.isFresh('a', 10)).toBe(true)
        expect(c.isFresh('a', 11)).toBe(false) // version moved on
        expect(c.isFresh('missing', 10)).toBe(false)
    })

    it('invalidate marks older entries stale but keeps the value for instant paint', () => {
        const c = new RowCache<number>()
        c.set('a', 1, 10)
        c.invalidate(11) // a vault change at v11
        expect(c.isFresh('a', 11)).toBe(false) // must revalidate
        expect(c.isFresh('a', 10)).toBe(false) // stale flag overrides version match
        expect(c.peek('a')).toBe(1) // value retained for the stale-while-revalidate paint
    })

    it('invalidate does not stale an entry already at the new version', () => {
        const c = new RowCache<number>()
        c.set('a', 1, 11) // resolved at v11
        c.invalidate(11) // same version — nothing to revalidate
        expect(c.isFresh('a', 11)).toBe(true)
    })

    it('re-setting at the new version clears the stale flag', () => {
        const c = new RowCache<number>()
        c.set('a', 1, 10)
        c.invalidate(11)
        expect(c.isFresh('a', 11)).toBe(false)
        c.set('a', 2, 11) // revalidated
        expect(c.isFresh('a', 11)).toBe(true)
        expect(c.peek('a')).toBe(2)
    })

    it('an older token settling after a newer token has already landed must not overwrite nor mark fresh', () => {
        const c = new RowCache<number>()
        const older = c.begin('a')
        const newer = c.begin('a')
        // the newer fetch settles first
        expect(c.set('a', 2, 10, newer)).toBe(true)
        expect(c.peek('a')).toBe(2)
        expect(c.isFresh('a', 10)).toBe(true)
        // the older fetch settles after — must be dropped, not overwrite the newer value
        expect(c.set('a', 1, 10, older)).toBe(false)
        expect(c.peek('a')).toBe(2)
        expect(c.isFresh('a', 10)).toBe(true)
    })

    it('set() with no token keeps the old unconditional-write behaviour', () => {
        const c = new RowCache<number>()
        c.begin('a')
        expect(c.set('a', 1, 10)).toBe(true)
        expect(c.peek('a')).toBe(1)
    })

    it('an erroring newer fetch keeps its token, so an older success settling after is dropped until the next invalidate re-revalidates', () => {
        const c = new RowCache<number>()
        const a = c.begin('a')
        c.begin('a') // B — the newer token. It errors and never calls set().
        // The older fetch A settles after B started (and after B errored) — still dropped,
        // because B's token is still the latest one begin() issued for this key.
        expect(c.set('a', 1, 10, a)).toBe(false)
        expect(c.peek('a')).toBeUndefined()
        expect(c.isFresh('a', 10)).toBe(false)

        // Self-heals: a version bump (a vault change) plus a fresh begin/set pair revalidates
        // normally, with no special-casing of the earlier failed race.
        c.invalidate(11)
        const fresh = c.begin('a')
        expect(c.set('a', 2, 11, fresh)).toBe(true)
        expect(c.peek('a')).toBe(2)
        expect(c.isFresh('a', 11)).toBe(true)
    })
})
