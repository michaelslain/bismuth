// app/src/migrationPoll.test.ts
import { test, expect } from 'bun:test'
import { migrationPollDelays } from './migrationPoll'

test('defaults produce 2s, 4s, 8s, 16s — the next doubling would exceed the 60s budget', () => {
    expect(migrationPollDelays()).toEqual([2000, 4000, 8000, 16000])
})

test('cumulative elapsed time of the default schedule never exceeds the 60s cap', () => {
    const delays = migrationPollDelays()
    const total = delays.reduce((sum, d) => sum + d, 0)
    expect(total).toBeLessThanOrEqual(60_000)
})

test('a zero budget produces no retries at all', () => {
    expect(migrationPollDelays({ maxElapsedMs: 0 })).toEqual([])
})

test('a budget that fits exactly one interval produces exactly one retry', () => {
    expect(migrationPollDelays({ initialDelayMs: 1000, maxElapsedMs: 1000 })).toEqual([1000])
})

test('a custom initial delay still doubles each step', () => {
    expect(
        migrationPollDelays({ initialDelayMs: 500, maxElapsedMs: 10_000 }),
    ).toEqual([500, 1000, 2000, 4000])
})

test('the schedule never produces more delays than fit the budget, one at a time', () => {
    // Regression guard for the failure mode this rule exists to prevent: a poll loop that never
    // stops. Even a huge budget must terminate with a finite, computable list.
    const delays = migrationPollDelays({ maxElapsedMs: 1_000_000 })
    expect(delays.length).toBeGreaterThan(0)
    expect(Number.isFinite(delays.length)).toBe(true)
    let elapsed = 0
    for (const d of delays) elapsed += d
    expect(elapsed).toBeLessThanOrEqual(1_000_000)
})
