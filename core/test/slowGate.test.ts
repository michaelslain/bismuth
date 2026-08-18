import { test, expect } from 'bun:test'
import { shouldRunSlowTests } from './slowGate'

test('slow suites run by default — an unset env must never silently drop coverage', () => {
    expect(shouldRunSlowTests({})).toBe(true)
    expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: undefined })).toBe(true)
})

test('only the exact string "1" opts out, so a stray value cannot disable suites by accident', () => {
    expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: '1' })).toBe(false)
    expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: '0' })).toBe(true)
    expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: 'true' })).toBe(true)
    expect(shouldRunSlowTests({ BISMUTH_FAST_TESTS: '' })).toBe(true)
})

test('it is independent of the live-test gate (opposite polarity, no shared env key)', () => {
    expect(shouldRunSlowTests({ BISMUTH_LIVE_TESTS: '1' })).toBe(true)
})
