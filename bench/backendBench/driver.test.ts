import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatFrame } from '../../core/src/chat'
import { CHAT_BACKENDS } from '../../core/src/chatProviders/backends'
import { createChatDriver, historyFrames, resumeChatDriver } from './driver'
import type { ChatDriver } from './types'
import { startModelServer } from './mock'
import { targetEnv, targetFromLabel } from './targets'
import { seedVault } from './vault'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const target = targetFromLabel('opencode@mock')
const run = target.binary ? describe : describe.skip

run('chat driver against opencode@mock', () => {
    const work = mkdtempSync(join(tmpdir(), 'bismuth-bench-driver-'))
    const saved: Record<string, string | undefined> = {}
    let vault = ''
    let server: Awaited<ReturnType<typeof startModelServer>>
    afterAll(async () => {
        for (const [k, v] of Object.entries(saved))
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        await server?.stop()
        rmSync(work, { recursive: true, force: true })
        if (vault) rmSync(vault, { recursive: true, force: true })
    })

    test('open, send, sessionId, close, history', async () => {
        server = await startModelServer({
            fixtures: [
                { match: { userMessage: 'hello' }, response: { content: 'Hello!' } },
            ],
        })
        // a clean home: the shared opencode server of this test must not touch the user's data
        const env = targetEnv(target, server, work, 'clean')
        for (const [k, v] of Object.entries(env)) {
            saved[k] = process.env[k]
            process.env[k] = v
        }
        vault = seedVault(target)
        const d = createChatDriver(target, vault)
        await d.open()
        const turn = await d.send('hello', { timeoutMs: 90_000 })
        expect(turn.ended).toBe('done')
        expect(turn.error).toBeNull()
        expect(turn.text).toContain('Hello!')
        expect(turn.firstTokenMs).not.toBeNull()
        expect(server.requests().length).toBeGreaterThan(0)
        const sid = d.sessionId()
        expect(sid).not.toBeNull()
        await d.close()
        expect(CHAT_BACKENDS.opencode.hasSession(d.chatId)).toBe(false)
        // the private chat leaves nothing behind to read; the call itself must not throw
        expect(Array.isArray(await historyFrames(target, vault, sid!))).toBe(true)
        void resumeChatDriver
    }, 120_000)
})

describe('chat driver result()', () => {
    test('an isError result frame fails the turn with its text', () => {
        const d = createChatDriver(target, '/nonexistent-vault') as any
        const frames = [
            { type: 'assistant-text', text: 'prompt is too long' },
            { type: 'result', isError: true },
        ]
        const r = d.result(frames, Date.now(), 'done')
        expect(r.error).toBe('prompt is too long')
        expect(r.ended).toBe('done')
        const ok = d.result([{ type: 'result', isError: false }], Date.now(), 'done')
        expect(ok.error).toBeNull()
    })
})

describe('chat driver unanswered prompts', () => {
    // A driver with no real session: frames are pushed through its sink while send waits.
    async function turn(
        frames: ChatFrame[],
        onFrame?: (f: ChatFrame, d: ChatDriver) => void,
    ) {
        const d = createChatDriver(target, '/nonexistent-vault') as any
        d.open = async () => {}
        const calls: string[] = []
        const lines: string[] = []
        d.log = (l: string) => lines.push(l)
        const rp = d.respondPermission.bind(d)
        d.respondPermission = (id: string, b: string) => {
            calls.push(`permission ${id} ${b}`)
            rp(id, b)
        }
        const rq = d.respondQuestion.bind(d)
        d.respondQuestion = (id: string, a: unknown) => {
            calls.push(`question ${id} ${a === null ? 'skip' : 'answer'}`)
            rq(id, a)
        }
        const p = d.send('hi', { timeoutMs: 400, onFrame })
        await sleep(50)
        for (const f of frames) d.sink(f)
        const r = await p
        d.abort()
        return { r, calls, lines }
    }
    const perm = { type: 'permission', id: 'p1', toolName: 'Write', input: {} } as ChatFrame
    const ask = { type: 'question', id: 'q1', questions: [] } as unknown as ChatFrame

    test('an unanswered permission is allowed and traced', async () => {
        const { r, calls, lines } = await turn([perm])
        expect(calls).toEqual(['permission p1 allow'])
        expect(r.autoAllowed).toEqual(['Write'])
        expect(lines).toEqual(['auto-allowed permission for Write'])
    })

    test('a permission the scenario denies is not overridden', async () => {
        const { r, calls } = await turn([perm], (f, d) => {
            if (f.type === 'permission') d.respondPermission(f.id, 'deny')
        })
        expect(calls).toEqual(['permission p1 deny'])
        expect(r.autoAllowed).toEqual([])
    })

    test('an unanswered question is skipped', async () => {
        const { calls } = await turn([ask])
        expect(calls).toEqual(['question q1 skip'])
    })

    test('a question the scenario answers is left alone', async () => {
        const { calls } = await turn([ask], (f, d) => {
            if (f.type === 'question') d.respondQuestion(f.id, { a: 'b' })
        })
        expect(calls).toEqual(['question q1 answer'])
    })
})
