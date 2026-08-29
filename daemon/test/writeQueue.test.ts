// The per-file serial mutex extracted from cron.ts. Two guarantees matter: writes to ONE path
// never interleave (that is the whole point), and a rejected write does not poison the chain for
// the next caller (cron writes must survive one bad write).
import { test, expect } from 'bun:test'
import { enqueueWrite } from '../src/lib/writeQueue'

const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

test('serializes writes to the same path, in call order', async () => {
    const order: string[] = []
    const a = enqueueWrite('/same', async () => {
        await tick(20)
        order.push('a')
    })
    const b = enqueueWrite('/same', async () => {
        order.push('b')
    })
    await Promise.all([a, b])
    expect(order).toEqual(['a', 'b'])
})

test('does not serialize across different paths', async () => {
    const order: string[] = []
    const slow = enqueueWrite('/one', async () => {
        await tick(20)
        order.push('slow')
    })
    const fast = enqueueWrite('/two', async () => {
        order.push('fast')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['fast', 'slow'])
})

test('a rejected write does not break the chain for the next caller', async () => {
    const boom = enqueueWrite('/chain', async () => {
        throw new Error('boom')
    })
    await expect(boom).rejects.toThrow('boom')
    await expect(
        enqueueWrite('/chain', async () => 'survived'),
    ).resolves.toBe('survived')
})

test('returns the callback result to its own caller', async () => {
    await expect(enqueueWrite('/ret', async () => 42)).resolves.toBe(42)
})
