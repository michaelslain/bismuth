import { test, expect } from 'bun:test'
import { dedupeInflight } from './inflight'

test('concurrent calls share one in-flight promise; a call after it settles starts a new one', async () => {
    let calls = 0
    let release!: () => void
    const f = dedupeInflight(() => {
        calls++
        return new Promise<number>(r => (release = () => r(calls)))
    })
    const a = f()
    const b = f()
    expect(calls).toBe(1)
    release()
    expect(await a).toBe(1)
    expect(await b).toBe(1)
    const c = f()
    expect(calls).toBe(2)
    release()
    expect(await c).toBe(2)
})
