import { expect, test } from 'bun:test'
import { createRefetcher, nextRefreshMs } from './statusBarFeed'
import type { StatusSegment } from '../../../core/src/statusBarEval'

const seg = (o: Partial<StatusSegment>): StatusSegment => ({ id: 'a', align: 'left', text: '', ...o })

test('nextRefreshMs: null without run/untrusted segments', () => {
    expect(nextRefreshMs(undefined)).toBeNull()
    expect(nextRefreshMs([seg({})])).toBeNull()
})

test('nextRefreshMs: min every, capped at 60s; untrusted polls at 60s', () => {
    expect(nextRefreshMs([seg({ every: 30 }), seg({ every: 10 })])).toBe(10_000)
    expect(nextRefreshMs([seg({ every: 600 })])).toBe(60_000)
    expect(nextRefreshMs([seg({ untrusted: { command: 'x' } })])).toBe(60_000)
})

test('refetcher coalesces a burst into one in flight + one queued', async () => {
    let calls = 0
    let release: () => void = () => {}
    const fetch = () => {
        calls++
        return new Promise<number>(r => (release = () => r(calls)))
    }
    const got: number[] = []
    const run = createRefetcher(fetch, v => got.push(v))
    run(); run(); run(); run()
    expect(calls).toBe(1)
    release()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toBe(2)
    release()
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toBe(2)
    expect(got).toEqual([1, 2])
})

test('refetcher keeps going after a failure without calling onResult', async () => {
    let n = 0
    const got: number[] = []
    const run = createRefetcher(() => (++n === 1 ? Promise.reject(new Error('x')) : Promise.resolve(n)), v => got.push(v))
    run()
    await new Promise(r => setTimeout(r, 0))
    run()
    await new Promise(r => setTimeout(r, 0))
    expect(got).toEqual([2])
})
