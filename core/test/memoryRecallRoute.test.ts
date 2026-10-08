import { test, expect } from 'bun:test'
import { createServer } from '../src/server'
import { makeSampleVault } from './helpers'
import { recallWithin } from '../src/memoryRecall'

test('POST /memory/recall: browser Origin refused 403, no Origin 200', async () => {
    const { vault, memory } = await makeSampleVault()
    const server = createServer({ vault, memory, port: 0 })
    const post = (headers: Record<string, string>) =>
        fetch(`http://localhost:${server.port}/memory/recall`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({
                mode: 'prompt',
                sessionId: 's',
                prompt: 'x',
            }),
        })
    try {
        expect((await post({ Origin: 'https://evil.example' })).status).toBe(
            403,
        )
        expect((await post({})).status).toBe(200)
    } finally {
        await server.stop(true)
    }
})

test('recallWithin: slow recall resolves to nothing, fast one passes through', async () => {
    const slow = new Promise<any>(r =>
        setTimeout(() => r({ context: 'late', injected: ['a'] }), 200),
    )
    expect((await recallWithin(slow, 20)).context).toBeNull()
    const fast = await recallWithin(
        Promise.resolve({ context: 'x', injected: ['a'] }),
        500,
    )
    expect(fast.context).toBe('x')
})
