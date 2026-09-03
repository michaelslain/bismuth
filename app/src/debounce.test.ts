// app/src/debounce.test.ts
import { test, expect } from 'bun:test'
import { debounce } from './debounce'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

test('coalesces rapid successive calls into a single invocation', async () => {
    let calls = 0
    const d = debounce(() => {
        calls++
    }, 20)
    d()
    d()
    d()
    expect(calls).toBe(0) // nothing fires synchronously
    await sleep(40)
    expect(calls).toBe(1)
})

test('invokes with the arguments from the most recent call', async () => {
    const seen: number[] = []
    const d = debounce((n: number) => {
        seen.push(n)
    }, 20)
    d(1)
    d(2)
    d(3)
    await sleep(40)
    expect(seen).toEqual([3])
})

test('fires again for a fresh burst after the wait elapses', async () => {
    let calls = 0
    const d = debounce(() => {
        calls++
    }, 20)
    d()
    await sleep(40)
    d()
    await sleep(40)
    expect(calls).toBe(2)
})

test('cancel() prevents a pending invocation', async () => {
    let calls = 0
    const d = debounce(() => {
        calls++
    }, 20)
    d()
    d.cancel()
    await sleep(40)
    expect(calls).toBe(0)
})

test('without maxWait, repeated calls defer indefinitely', async () => {
    let calls = 0
    const d = debounce(() => calls++, 50)
    for (let i = 0; i < 6; i++) {
        d()
        await sleep(30)
    }
    expect(calls).toBe(0) // 6 x 30ms of re-arming, never a 50ms gap
    d.cancel()
})

test('maxWait forces a call even while re-arming continues', async () => {
    let calls = 0
    const d = debounce(() => calls++, 50, { maxWait: 120 })
    for (let i = 0; i < 6; i++) {
        d()
        await sleep(30)
    }
    expect(calls).toBeGreaterThanOrEqual(1)
    d.cancel()
})

test('cancel clears a pending maxWait timer too', async () => {
    let calls = 0
    const d = debounce(() => calls++, 50, { maxWait: 60 })
    d()
    d.cancel()
    await sleep(150)
    expect(calls).toBe(0)
})
