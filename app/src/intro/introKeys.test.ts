import { GlobalWindow } from 'happy-dom'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { introKeyAction } from './introKeys'

// KeyboardEvent only exists after beforeAll installs it; restored in afterAll so the one-process
// `bun test app/src` run is not polluted (see VaultIntro.test.ts).
let KE: typeof KeyboardEvent
let installed = false
beforeAll(() => {
    if (!('KeyboardEvent' in globalThis)) {
        ;(globalThis as Record<string, unknown>).KeyboardEvent = new GlobalWindow().KeyboardEvent
        installed = true
    }
    KE = globalThis.KeyboardEvent
})
afterAll(() => {
    if (installed) delete (globalThis as Record<string, unknown>).KeyboardEvent
})

const key = (k: string, init: KeyboardEventInit = {}) =>
    introKeyAction(new KE('keydown', { key: k, ...init }))

describe('introKeyAction', () => {
    it('ArrowRight is next', () => expect(key('ArrowRight')).toBe('next'))
    it('ArrowLeft is prev', () => expect(key('ArrowLeft')).toBe('prev'))
    it('Escape (the default dismiss binding) is skip', () =>
        expect(key('Escape')).toBe('skip'))
    it('an unrelated key is null', () => {
        expect(key('a')).toBeNull()
        expect(key('Enter')).toBeNull()
    })
    it('Escape with a modifier is not the dismiss key', () =>
        expect(key('Escape', { metaKey: true })).toBeNull())
})
