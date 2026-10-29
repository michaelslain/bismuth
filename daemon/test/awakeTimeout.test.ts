import { test, expect } from 'bun:test'
import { startAwakeTimeout } from '../src/daemon/awakeTimeout.ts'

const SEC = 1_000
const TICK = 5 * SEC

/** A hand-driven clock and interval: `advance(ms)` moves the clock, then runs one tick. */
function harness(budgetMs: number) {
    let clock = 0
    let tick: (() => void) | undefined
    let cleared = false
    let expired = 0
    const clear = startAwakeTimeout(budgetMs, () => expired++, {
        tickMs: TICK,
        now: () => clock,
        setInterval: fn => {
            tick = fn
            return 1
        },
        clearInterval: () => {
            cleared = true
        },
    })
    return {
        clear,
        advance(ms: number) {
            clock += ms
            tick?.()
        },
        ticks(n: number) {
            for (let i = 0; i < n; i++) this.advance(TICK)
        },
        get expired() {
            return expired
        },
        get cleared() {
            return cleared
        },
    }
}

test('a 15-minute suspend does not count toward a 900 s budget', () => {
    const h = harness(900 * SEC)
    h.ticks(2) // 10 s awake
    h.advance(15 * 60 * SEC) // asleep past the wall-clock deadline
    expect(h.expired).toBe(0)
    h.ticks(1)
    expect(h.expired).toBe(0)
})

test('it expires once, after 900 s of awake ticks', () => {
    const h = harness(900 * SEC)
    h.ticks(900 / 5 - 1)
    expect(h.expired).toBe(0)
    h.ticks(1)
    expect(h.expired).toBe(1)
    expect(h.cleared).toBe(true)
    h.ticks(10)
    expect(h.expired).toBe(1)
})

test('clear() stops it', () => {
    const h = harness(10 * SEC)
    h.clear()
    expect(h.cleared).toBe(true)
    h.ticks(10)
    expect(h.expired).toBe(0)
})
