import { describe, expect, test } from 'bun:test'
import { runHeadlessTurn } from '../src/chatProviders/headlessTurn'
import type { ChatBackend } from '../src/chatProviders/backends'
import type { ChatFrame, ChatSink } from '../src/chat'
import type { BackendId } from '../src/agentBackends/catalog'

function fake(script: (sink: ChatSink) => void) {
    const calls: string[] = []
    let closed = 0
    const be = {
        id: 'opencode',
        openSession: () => void calls.push('open'),
        setModel: (_: string, m: string) => void calls.push(`model:${m}`),
        sendMessage: (c: { sink: ChatSink }) => {
            calls.push('send')
            script(c.sink)
        },
        setPrivate: () => void calls.push('private'),
        closeChat: () => {
            closed++
            calls.push('close')
        },
    } as unknown as ChatBackend
    return { backends: { opencode: be } as Record<BackendId, ChatBackend>, calls, closed: () => closed }
}
const turn = { backend: 'opencode' as BackendId, cwd: '/x', text: 'hi' }
const result: ChatFrame = { type: 'result', isError: false, numTurns: 1, costUsd: null }

describe('runHeadlessTurn', () => {
    test('joins assistant text across frames and closes', async () => {
        const f = fake(sink => {
            sink({ type: 'assistant-text', text: 'ab' })
            sink({ type: 'assistant-text', text: 'cd' })
            sink(result)
            sink({ type: 'done' })
        })
        expect(await runHeadlessTurn(turn, f)).toBe('abcd')
        expect(f.closed()).toBe(1)
        expect(f.calls).toEqual(['send', 'private', 'close'])
    })
    test('result isError rejects and closes', async () => {
        const f = fake(sink => sink({ ...result, isError: true } as ChatFrame))
        await expect(runHeadlessTurn(turn, f)).rejects.toThrow()
        expect(f.closed()).toBe(1)
    })
    test('error frame rejects', async () => {
        const f = fake(sink => sink({ type: 'error', code: 'spawn', message: 'boom' }))
        await expect(runHeadlessTurn(turn, f)).rejects.toThrow('boom')
        expect(f.closed()).toBe(1)
    })
    test('never-ending turn rejects at timeout', async () => {
        const f = fake(() => {})
        await expect(runHeadlessTurn({ ...turn, timeoutMs: 20 }, f)).rejects.toThrow('timed out')
        expect(f.closed()).toBe(1)
        expect(f.calls).toEqual(['send', 'private', 'close'])
    })
    test('a permission frame rejects promptly and closes', async () => {
        const f = fake(sink =>
            sink({ type: 'permission', toolName: 'Bash' } as unknown as ChatFrame),
        )
        const t0 = Date.now()
        await expect(runHeadlessTurn({ ...turn, timeoutMs: 5000 }, f)).rejects.toThrow(
            'opencode asked for Bash; transcription allows no tools',
        )
        expect(Date.now() - t0).toBeLessThan(1000)
        expect(f.closed()).toBe(1)
    })
    test('model reaches setModel before sendMessage', async () => {
        const f = fake(sink => sink(result))
        await runHeadlessTurn({ ...turn, model: 'm1' }, f)
        expect(f.calls).toEqual(['open', 'model:m1', 'send', 'private', 'close'])
    })
})
