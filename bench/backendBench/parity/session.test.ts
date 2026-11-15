// bench/backendBench/parity/session.test.ts
// Each session scenario's `run` against a fake ScenarioCtx: no backend, no model.
import { describe, expect, test } from 'bun:test'
import type { ChatFrame } from '../../../core/src/chat'
import type {
    BenchTarget,
    ChatDriver,
    ModelRequest,
    ScenarioCtx,
    TurnResult,
} from '../types'
import scenarios from './session'

const byId = (id: string) => scenarios.find(s => s.id === id)!

const target = (caps: Record<string, unknown> = {}, source: unknown = { kind: 'mock' }) =>
    ({
        label: 'fake@mock',
        backend: 'opencode',
        source,
        binary: '/bin/fake',
        caps: { historyReplay: true, sessionPicker: true, ...caps },
    }) as BenchTarget

const FULL = 'LaTeX math with KaTeX quill CLI does everything Bismuth does'

type Opts = {
    /** body text each request carries, given the turn's text and whether the window is big */
    body?: (text: string, window: number | null) => string
    est?: (text: string, n: number, window: number | null) => number
    sessionId?: string | null
    history?: ChatFrame[] | ((call: number) => ChatFrame[])
    chatList?: string
    error?: string
}

function fake(o: Opts = {}) {
    const requests: ModelRequest[] = []
    const state = { window: null as number | null, resumed: '' as string, privateOn: 0, sent: [] as string[], historyCalls: 0 }
    const mk = (): ChatDriver => {
        const frames: ChatFrame[] = []
        const chat = {
            chatId: 'c',
            vault: '/v',
            frames,
            open: async () => {},
            send: async (text: string): Promise<TurnResult> => {
                state.sent.push(text)
                const body = o.body ? o.body(text, state.window) : `${FULL} ${text}`
                requests.push({
                    path: '/v1',
                    body,
                    estTokens: o.est ? o.est(text, requests.length, state.window) : 100,
                    at: 0,
                })
                frames.push({ type: 'assistant-text', text: 'ok' })
                return {
                    frames,
                    text: 'ok',
                    toolUses: [],
                    error: o.error ?? null,
                    firstTokenMs: 1,
                    wallMs: 1,
                    ended: o.error ? 'error' : 'done',
                }
            },
            sendMidTurn() {},
            abort() {},
            respondPermission() {},
            respondQuestion() {},
            setModel() {},
            setAgent() {},
            setEffort() {},
            setPrivate(on: boolean) {
                if (on) state.privateOn++
            },
            sessionId: () => (o.sessionId === undefined ? 'ses_1234567890' : o.sessionId),
            close: async () => {},
        }
        return chat as unknown as ChatDriver
    }
    const ctx = {
        target: target(),
        vault: '/v',
        newChat: async () => mk(),
        resumeChat: async (id: string) => {
            state.resumed = id
            return mk()
        },
        history: async () => {
            state.historyCalls++
            return typeof o.history === 'function' ? o.history(state.historyCalls) : (o.history ?? [])
        },
        bismuth: async () => ({ code: 0, stdout: o.chatList ?? '', stderr: '' }),
        modelRequests: () => requests,
        setWindow: (t: number | null) => {
            state.window = t
        },
        log: () => {},
    } as unknown as ScenarioCtx
    return { ctx, requests, state }
}

describe('applies', () => {
    test('gates by install, capability and watched model', () => {
        expect(byId('small-window').applies(target({}, { kind: 'cloud' }))?.verdict).toBe('skip')
        expect(byId('compaction').applies({ ...target(), binary: null })?.verdict).toBe('skip')
        expect(byId('history-replay').applies(target({ historyReplay: false }))?.verdict).toBe('gap')
        expect(byId('history-list').applies(target({ sessionPicker: false }))?.verdict).toBe('gap')
        expect(byId('resume').applies(target())).toBeNull()
        expect(scenarios.map(s => s.id)).toEqual([
            'resume',
            'history-replay',
            'history-list',
            'private-erase',
            'small-window',
            'compaction',
        ])
    })
})

describe('resume', () => {
    test('passes when the resumed request carries turn 1', async () => {
        const { ctx, state } = fake({
            body: (t, _w) => (t.includes('repeat') ? 'history mango-7Q repeat' : t),
        })
        expect((await byId('resume').run(ctx)).verdict).toBe('pass')
        expect(state.resumed).toBe('ses_1234567890')
    })
    test('fails when the resumed request has lost the history', async () => {
        const { ctx } = fake()
        const out = await byId('resume').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('lost its history')
    })
    test('fails with no session id', async () => {
        const out = await byId('resume').run(fake({ sessionId: null }).ctx)
        expect(out.detail).toContain('no session frame')
    })
})

describe('history-replay', () => {
    const u = (text: string): ChatFrame => ({ type: 'user-message', text })
    const a = (text: string): ChatFrame => ({ type: 'assistant-text', text })
    test('passes on both turns in order', async () => {
        const { ctx } = fake({
            history: [u('history one for the bench'), a('x'), u('history two for the bench'), a('y')],
        })
        expect((await byId('history-replay').run(ctx)).verdict).toBe('pass')
    })
    test('fails when turn 2 is missing', async () => {
        const { ctx } = fake({ history: [u('history one for the bench'), a('x')] })
        const out = await byId('history-replay').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('turn 2 user-message missing')
    })
    test('fails when the last answer is missing', async () => {
        const { ctx } = fake({
            history: [u('history one for the bench'), a('x'), u('history two for the bench')],
        })
        expect((await byId('history-replay').run(ctx)).detail).toContain('after turn 2')
    })
})

describe('history-list', () => {
    test('fails when the chat is absent from chat list (opencode missing from history)', async () => {
        const { ctx } = fake({ chatList: 'other-chat 1 message' })
        const out = await byId('history-list').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('bismuth chat list does not show ses_1234567890')
    })
})

describe('private-erase', () => {
    const pubFrames: ChatFrame[] = [{ type: 'user-message', text: 'private one for the bench' }]
    test('passes when the public control is readable and the private chat leaves nothing', async () => {
        const { ctx } = fake({ history: n => (n === 1 ? pubFrames : []) })
        expect((await byId('private-erase').run(ctx)).verdict).toBe('pass')
    })
    test('fails when history is empty for the public control too (proves nothing)', async () => {
        const out = await byId('private-erase').run(fake().ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('control')
    })
    test('fails when messages remain after the private close', async () => {
        const { ctx } = fake({ history: () => pubFrames })
        const out = await byId('private-erase').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('still has 1')
    }, 25_000)
    test('applies needs historyReplay', () => {
        expect(byId('private-erase').applies(target({ historyReplay: false }))?.verdict).toBe('gap')
    })
})

describe('small-window', () => {
    test('passes on a lean small request and a full big one', async () => {
        const { ctx } = fake({ est: (_t, _n, w) => (w === 8192 ? 3000 : 20000) })
        const out = await byId('small-window').run(ctx)
        expect(out.verdict).toBe('pass')
    })
    test('fails when the first request is over 8192', async () => {
        const { ctx, requests } = fake({ est: () => 9000 })
        requests.push({ path: '/title', body: 'title me', estTokens: 10, at: 0 })
        const out = await byId('small-window').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('~9000 tokens, over the 8192 window')
    })
    test('ignores a leading title request without instructions', async () => {
        const { ctx, requests } = fake({ est: (_t, _n, w) => (w === 8192 ? 3000 : 20000) })
        requests.push({ path: '/title', body: 'title me', estTokens: 10, at: 0 })
        expect((await byId('small-window').run(ctx)).verdict).toBe('pass')
    })
    test('fails when the 131072 request drops the daemon name', async () => {
        const { ctx } = fake({
            body: (t, w) => (w === 131072 ? `LaTeX math with KaTeX CLI does everything Bismuth does ${t}` : `${FULL} ${t}`),
            est: () => 3000,
        })
        const out = await byId('small-window').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('daemon name quill')
    })
    test('fails on an overflow error and restores the window', async () => {
        const { ctx, state } = fake({ error: 'The number of tokens to keep is greater than the context length' })
        const out = await byId('small-window').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(state.window).toBeNull()
    })
})

describe('bench chats leave no history', () => {
    const u = (text: string): ChatFrame => ({ type: 'user-message', text })
    test('resume erases the chat it kept', async () => {
        const { ctx, state } = fake()
        await byId('resume').run(ctx)
        expect(state.privateOn).toBe(1)
    })
    test('history-replay erases the chat it kept', async () => {
        const { ctx, state } = fake({
            history: [u('history one for the bench'), { type: 'assistant-text', text: 'x' }, u('history two for the bench'), { type: 'assistant-text', text: 'y' }],
        })
        await byId('history-replay').run(ctx)
        expect(state.privateOn).toBe(1)
        expect(state.resumed).toBe('ses_1234567890')
    })
    test('history-list erases the chat it kept', async () => {
        const { ctx, state } = fake({ chatList: 'ses_1234567890' })
        await byId('history-list').run(ctx)
        expect(state.privateOn).toBe(1)
    })
})

describe('compaction', () => {
    test('fixtures answer opencode\'s summary and checkpoint-update requests, and no marker-free catch-all', () => {
        const fx = byId('compaction').mockFixtures as { match: { userMessage: string }; response: { content: string } }[]
        const msgs = fx.map(f => f.match.userMessage)
        expect(msgs).toContain('summarize the conversation above into a structured summary that will be given to another agent')
        expect(msgs).toContain('Update the existing checkpoint in the conversation above into one consolidated summary')
        for (const m of msgs) expect(m.length).toBeGreaterThan(20)
        const summaries = fx.filter(f => !f.match.userMessage.startsWith('bench-compact-turn-'))
        for (const f of summaries) expect(f.response.content).not.toContain('bench-compact-turn-')
    })
    test('fixtures also answer claude\'s summary prompt and codex\'s checkpoint prompt, ahead of the turns', () => {
        const fx = byId('compaction').mockFixtures as { match: { userMessage: string } }[]
        const msgs = fx.map(f => f.match.userMessage)
        const claude = msgs.indexOf('Your task is to create a detailed summary of the conversation so far')
        const codex = msgs.indexOf('You are performing a CONTEXT CHECKPOINT COMPACTION')
        const firstTurn = msgs.findIndex(m => m.startsWith('bench-compact-turn-'))
        expect(claude).toBeGreaterThanOrEqual(0)
        expect(codex).toBeGreaterThanOrEqual(0)
        expect(claude).toBeLessThan(firstTurn)
        expect(codex).toBeLessThan(firstTurn)
    })
    test('fixtures also answer goose\'s summary prompt, ahead of the turns', () => {
        const fx = byId('compaction').mockFixtures as { match: { userMessage: string } }[]
        const msgs = fx.map(f => f.match.userMessage)
        const goose = msgs.indexOf('Please summarize the conversation history provided in the system prompt')
        expect(goose).toBeGreaterThanOrEqual(0)
        expect(goose).toBeLessThan(msgs.findIndex(m => m.startsWith('bench-compact-turn-')))
    })
    test('detects compaction by the main request when a summary request goes first', async () => {
        const turnOf = (t: string) => Number(/turn-(\d+)-marker/.exec(t)?.[1])
        const { ctx, requests } = fake({ est: t => (turnOf(t) < 4 ? 1000 * turnOf(t) : 500) })
        const make = ctx.newChat.bind(ctx)
        ctx.newChat = async () => {
            const chat = await make()
            const send = chat.send.bind(chat)
            chat.send = async (text, o) => {
                // the backend summarises first, sending the whole history in one large request
                if (turnOf(text) === 4)
                    requests.push({ path: '/v1', body: `summary ${text}`, estTokens: 20000, at: 0 })
                const r = await send(text, o)
                // the main request is the one that carries the agent's tools
                requests[requests.length - 1].body = { tools: [{}], text }
                return r
            }
            return chat
        }
        const out = await byId('compaction').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(out.detail).toContain('compacted at turn 4')
    })
    test('passes when it compacts and keeps one copy', async () => {
        // estTokens grows, then the backend compacts at turn 4 (drops back down)
        const { ctx } = fake({ est: (_t, n) => (n < 3 ? 1000 * (n + 1) : n === 3 ? 500 : 1000) })
        const out = await byId('compaction').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(out.detail).toContain('compacted at turn 4')
    })
    test('fails when a post-compaction request duplicates the latest message', async () => {
        const { ctx } = fake({
            body: t => `${t} ${t}`,
            est: (_t, n) => (n < 3 ? 1000 * (n + 1) : n === 3 ? 500 : 1000),
        })
        const out = await byId('compaction').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('2 copies')
    })
    test('fails when the duplicate appears only on the compaction turn', async () => {
        const { ctx } = fake({
            body: t => (t.includes('turn-4-marker') ? `${t} ${t}` : t),
            est: (_t, n) => (n < 3 ? 1000 * (n + 1) : n === 3 ? 500 : 1000),
        })
        const out = await byId('compaction').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('turn 4 request carries 2 copies')
    })
    test('fails when a turn errors', async () => {
        const out = await byId('compaction').run(fake({ error: 'context window maximized' }).ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('turn 1 ended error')
    })
})

describe('small-window applies', () => {
    test('claude is measured like every other backend', () => {
        const t = { ...target({ localModel: true }), backend: 'claude', binary: '/bin/claude' }
        expect(byId('small-window').applies(t as never)).toBeNull()
    })
})

describe('small-window and compaction applies', () => {
    for (const id of ['small-window', 'compaction'])
        test(`${id} is a gap for a backend that cannot run on a local model`, () => {
            expect(byId(id).applies(target({ localModel: false }))).toEqual({
                verdict: 'gap',
                reason: 'this backend cannot run on a local model',
            })
            expect(byId(id).applies(target({ localModel: true }))).toBeNull()
        })
})
