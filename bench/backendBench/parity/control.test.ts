// bench/backendBench/parity/control.test.ts
// Each control scenario's `run` against a fake ScenarioCtx: no backend, no model.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatFrame } from '../../../core/src/chat'
import type {
    BenchTarget,
    ChatDriver,
    ModelRequest,
    ScenarioCtx,
    TurnResult,
} from '../types'
import scenarios, { instructionSignature } from './control'

const byId = (id: string) => scenarios.find(s => s.id === id)!

const target = (caps: Record<string, unknown> = {}): BenchTarget =>
    ({
        label: 'fake@mock',
        backend: 'opencode',
        source: { kind: 'mock' },
        binary: '/bin/fake',
        caps: { permissionPrompts: true, midTurnMessages: true, models: true, ...caps },
    }) as BenchTarget

type Behavior = {
    /** frames the next send emits, in order; `onFrame` sees each */
    send?: (text: string, emit: (f: ChatFrame) => void, d: FakeChat) => Promise<void> | void
    ended?: TurnResult['ended']
}

class FakeChat implements ChatDriver {
    chatId = 'c1'
    vault: string
    frames: ChatFrame[] = []
    aborted = 0
    mids: string[] = []
    modelSet: string[] = []
    constructor(
        vault: string,
        private beh: Behavior,
        private ctx: { requests: ModelRequest[] },
    ) {
        this.vault = vault
    }
    async open() {}
    async send(text: string, opts?: Parameters<ChatDriver['send']>[1]): Promise<TurnResult> {
        this.ctx.requests.push({ path: '/v1', body: { text, model: this.modelSet.at(-1) }, estTokens: 1, at: 0 })
        const start = this.frames.length
        const emit = (f: ChatFrame) => {
            this.frames.push(f)
            opts?.onFrame?.(f, this)
        }
        await this.beh.send?.(text, emit, this)
        return {
            frames: this.frames,
            text: this.frames.slice(start).map(f => (f.type === 'assistant-text' ? f.text : '')).join(''),
            toolUses: [],
            error: null,
            firstTokenMs: 1,
            wallMs: 1,
            ended: this.beh.ended ?? 'done',
        }
    }
    sendMidTurn(text: string) {
        this.mids.push(text)
    }
    abort() {
        this.aborted++
    }
    respondPermission(id: string, behavior: 'allow' | 'deny') {
        this.frames.push({ type: 'user-message', text: `perm:${id}:${behavior}` })
        this.lastPerm = behavior
    }
    lastPerm = ''
    respondQuestion() {}
    setModel(m: string) {
        this.modelSet.push(m)
    }
    agentSet: string[] = []
    effortSet: string[] = []
    setAgent(a: string) {
        this.agentSet.push(a)
    }
    setEffort(e: string) {
        this.effortSet.push(e)
    }
    privateSet: boolean[] = []
    setPrivate(on: boolean) {
        this.privateSet.push(on)
    }
    sid: string | null = null
    sessionId() {
        return this.sid
    }
    async close() {}
}

function fakeCtx(beh: Behavior) {
    const vault = mkdtempSync(join(tmpdir(), 'control-test-'))
    mkdirSync(join(vault, 'notes'), { recursive: true })
    const state = { requests: [] as ModelRequest[] }
    const chat = new FakeChat(vault, beh, state)
    const ctx = {
        target: target(),
        vault,
        newChat: async () => chat,
        modelRequests: () => state.requests,
        log: () => {},
    } as unknown as ScenarioCtx
    return { ctx, chat, vault, state }
}

const perm = (f: (b: string) => void = () => {}) => (_t: string, emit: (f: ChatFrame) => void, d: FakeChat) => {
    emit({ type: 'permission', id: 'p1', toolName: 'write', input: {} })
    f(d.lastPerm)
}

describe('applies', () => {
    test('permission scenarios gap without permissionPrompts', () => {
        expect(byId('permission-allow').applies(target({ permissionPrompts: false }))?.verdict).toBe('gap')
        expect(byId('mid-turn').applies(target({ midTurnMessages: false }))?.verdict).toBe('gap')
        expect(byId('models').applies(target({ models: false }))?.verdict).toBe('gap')
        expect(byId('stop').applies({ ...target(), binary: null })?.verdict).toBe('skip')
        expect(byId('stop').applies(target())).toBeNull()
    })
})

describe('permission', () => {
    test('deny passes when nothing is written', async () => {
        const { ctx } = fakeCtx({ send: perm() })
        expect((await byId('permission-deny').run(ctx)).verdict).toBe('pass')
    })
    test('deny fails when the file appears anyway', async () => {
        const { ctx, vault } = fakeCtx({ send: perm(() => writeFileSync(join(vault, 'notes/new.md'), 'x')) })
        const out = await byId('permission-deny').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('was written')
    })
    test('allow passes when the file exists, fails when it does not', async () => {
        const ok = fakeCtx({})
        ok.chat.send = (async (_t: string, o: any) => {
            o.onFrame({ type: 'permission', id: 'p', toolName: 'write', input: {} }, ok.chat)
            writeFileSync(join(ok.vault, 'notes/new.md'), 'x')
            return { ended: 'done', toolUses: [], error: null } as unknown as TurnResult
        }) as any
        expect((await byId('permission-allow').run(ok.ctx)).verdict).toBe('pass')
        const bad = fakeCtx({ send: perm() })
        const out = await byId('permission-allow').run(bad.ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('does not exist')
    })
    test('fails when no permission frame arrives', async () => {
        const { ctx } = fakeCtx({})
        const out = await byId('permission-allow').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('no permission frame')
    })
})

describe('stop', () => {
    const text = (emit: (f: ChatFrame) => void) => emit({ type: 'assistant-text', text: 'hi' })
    test('passes: abort once, no text after, next turn answers', async () => {
        const { ctx, chat } = fakeCtx({
            send: (t, emit) => {
                text(emit)
                if (t.startsWith('say')) text(emit)
            },
        })
        const out = await byId('stop').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.aborted).toBe(1)
    })
    test('fails when text keeps streaming after abort', async () => {
        const { ctx } = fakeCtx({
            send: (t, emit) => {
                text(emit)
                if (!t.startsWith('say')) text(emit)
            },
        })
        const out = await byId('stop').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('after abort')
    })
    test('fails when the next turn does not answer', async () => {
        const { ctx } = fakeCtx({ send: (t, emit) => (t.startsWith('say') ? undefined : text(emit)) })
        const out = await byId('stop').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('next turn after abort')
    })
})

describe('mid-turn', () => {
    test('passes on delivered + request containing the text', async () => {
        const { ctx, state } = fakeCtx({
            send: (_t, emit, d) => {
                emit({ type: 'assistant-text', text: 'a' })
                emit({ type: 'delivered', ids: ['m1'] })
                state.requests.push({ path: '/v1', body: { m: d.mids[0] }, estTokens: 1, at: 0 })
            },
        })
        expect((await byId('mid-turn').run(ctx)).verdict).toBe('pass')
    }, 20_000)
    test('fails when the model never sees it', async () => {
        const { ctx } = fakeCtx({
            send: (_t, emit) => {
                emit({ type: 'assistant-text', text: 'a' })
                emit({ type: 'delivered', ids: ['m1'] })
            },
        })
        const out = await byId('mid-turn').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('contains the mid-turn text')
    }, 30_000)
})

describe('models', () => {
    const list = (n: number): ChatFrame => ({
        type: 'models',
        models: Array.from({ length: n }, (_, i) => ({
            value: `mock/m${i}`,
            label: `m${i}`,
            description: '',
            effortLevels: [],
        })),
    })
    test('fails with no models frame', async () => {
        const { ctx } = fakeCtx({})
        ctx.newChat = (async () => {
            const c = new FakeChat('', {}, { requests: [] })
            return c
        }) as any
        const out = await byId('models').run(ctx)
        expect(out.verdict).toBe('fail')
    }, 30_000)
    test('passes when the next request names the new model', async () => {
        const { ctx, chat } = fakeCtx({})
        chat.frames.push(list(2))
        const out = await byId('models').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.modelSet).toEqual(['mock/m1'])
    })
    test('a non-opencode mock target keeps every listed model', async () => {
        const { ctx, chat } = fakeCtx({})
        ctx.target = { ...ctx.target, backend: 'claude' } as BenchTarget
        chat.frames.push({
            type: 'models',
            models: [
                { value: 'sonnet', label: 's', description: '', effortLevels: [] },
                { value: 'opus', label: 'o', description: '', effortLevels: [] },
            ],
        })
        const out = await byId('models').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.modelSet).toEqual(['opus'])
    })
    test('skips when fewer than two mock models are listed', async () => {
        const { ctx, chat } = fakeCtx({})
        chat.frames.push({
            type: 'models',
            models: [
                { value: 'mock/m0', label: 'm0', description: '', effortLevels: [] },
                { value: 'anthropic/real', label: 'r', description: '', effortLevels: [] },
            ],
        })
        const out = await byId('models').run(ctx)
        expect(out.verdict).toBe('skip')
        expect(chat.modelSet).toEqual([])
    })
    test('passes on model-refused, fails when ignored', async () => {
        const refused = fakeCtx({ send: (_t, emit) => emit({ type: 'model-refused', model: 'mock/m1', current: 'mock/m0' }) })
        refused.chat.frames.push(list(2))
        refused.chat.setModel = () => {}
        expect((await byId('models').run(refused.ctx)).verdict).toBe('pass')
        const ignored = fakeCtx({})
        ignored.chat.frames.push(list(2))
        ignored.chat.setModel = () => {}
        const out = await byId('models').run(ignored.ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('do not name it')
    })
})

describe('agents', () => {
    const agentsFrame = (n: number): ChatFrame => ({
        type: 'agents',
        current: 'build',
        agents: Array.from({ length: n }, (_, i) => ({ value: `a${i}`, label: `a${i}`, description: '' })),
    })
    /** Requests carry the system prompt of `agent()`; `resumeAgent` is what a resumed chat runs. */
    function setup(opts: { n?: number; honorSet?: boolean; resumeKeeps?: boolean }) {
        const state = { requests: [] as ModelRequest[] }
        const vault = mkdtempSync(join(tmpdir(), 'control-test-'))
        const mk = (agent: () => string) => {
            const c: FakeChat = new FakeChat(vault, {}, state)
            c.sid = 's1'
            const base = c.send.bind(c)
            c.send = async (text, o) => {
                const r = await base(text, o)
                state.requests[state.requests.length - 1].body = {
                    messages: [{ role: 'system', content: `you are ${agent()}` }, { role: 'user', content: text }],
                }
                return r
            }
            return c
        }
        const chat = mk(() => (opts.honorSet === false ? 'a0' : chat.agentSet.at(-1) ?? 'a0'))
        chat.frames.push(agentsFrame(opts.n ?? 2))
        const resumed = mk(() => (opts.resumeKeeps === false ? 'a0' : 'a1'))
        const ctx = {
            target: target({ agents: true }),
            vault,
            newChat: async () => chat,
            resumeChat: async () => resumed,
            modelRequests: () => state.requests,
            log: () => {},
        } as unknown as ScenarioCtx
        return { ctx, chat }
    }
    test('applies: gap without agents, skip on a cloud model', () => {
        expect(byId('agents').applies(target({ agents: false }))?.verdict).toBe('gap')
        expect(byId('agents').applies({ ...target({ agents: true }), source: { kind: 'cloud' } })?.verdict).toBe('skip')
    })
    test('passes when the switch changes the request and the resume keeps it', async () => {
        const { ctx, chat } = setup({})
        const out = await byId('agents').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.agentSet).toEqual(['a1'])
    })
    test('the first chat leaves private mode so closing it keeps the session for the resume', async () => {
        const { ctx, chat } = setup({})
        await byId('agents').run(ctx)
        expect(chat.privateSet).toEqual([false])
    })
    test('a run that stops before the resume hands the chat back to private', async () => {
        const { ctx, chat } = setup({ n: 1 })
        await byId('agents').run(ctx)
        expect(chat.privateSet).toEqual([false, true])
    })
    test('fails when setAgent leaves the request on the old agent', async () => {
        const out = await byId('agents').run(setup({ honorSet: false }).ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('left the next request on the old agent')
    })
    test('a title request after the main one does not fool the comparison', async () => {
        const { ctx, chat } = setup({ honorSet: false })
        const state = ctx.modelRequests() as ModelRequest[]
        const send = chat.send.bind(chat)
        let n = 0
        chat.send = async (text, o) => {
            const r = await send(text, o)
            if (n++ === 0) state.push({ path: '/v1', body: { messages: [{ role: 'system', content: 'title' }, { role: 'user', content: 'name this chat' }] }, estTokens: 1, at: 0 })
            return r
        }
        const out = await byId('agents').run(ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('left the next request on the old agent')
    })
    test('fails when the resumed chat drops the agent', async () => {
        const out = await byId('agents').run(setup({ resumeKeeps: false }).ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('resumed chat dropped a1')
    })
    test('fails with fewer than two agents', async () => {
        const out = await byId('agents').run(setup({ n: 1 }).ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('need 2')
    })
})

describe('models: where the switched model shows up on the wire', () => {
    const two = (a: string, b: string): ChatFrame => ({
        type: 'models',
        models: [a, b].map(v => ({ value: v, label: v, description: '', effortLevels: [] })),
    })
    test('a provider: prefix is stripped (hermes sends mock-2 for custom:mock-2)', async () => {
        const { ctx, chat, state } = fakeCtx({})
        ctx.target = { ...ctx.target, backend: 'hermes' } as BenchTarget
        chat.frames.push(two('custom:mock', 'custom:mock-2'))
        const base = chat.send.bind(chat)
        chat.send = async (t, o) => {
            const r = await base(t, o)
            state.requests[state.requests.length - 1].body = { model: 'mock-2' }
            return r
        }
        expect((await byId('models').run(ctx)).verdict).toBe('pass')
    })
    test('gemini names its model in the URL path, not the body', async () => {
        const { ctx, chat, state } = fakeCtx({})
        ctx.target = { ...ctx.target, backend: 'gemini' } as BenchTarget
        chat.frames.push(two('gemini-3.5-flash', 'gemini-3.5-flash-lite'))
        const base = chat.send.bind(chat)
        chat.send = async (t, o) => {
            const r = await base(t, o)
            const q = state.requests[state.requests.length - 1]
            q.path = '/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent'
            q.body = { contents: [] }
            return r
        }
        expect((await byId('models').run(ctx)).verdict).toBe('pass')
    })
    test('a model named nowhere still fails', async () => {
        const { ctx, chat, state } = fakeCtx({})
        ctx.target = { ...ctx.target, backend: 'claude' } as BenchTarget
        chat.frames.push(two('custom:mock', 'custom:mock-2'))
        const base = chat.send.bind(chat)
        chat.send = async (t, o) => {
            const r = await base(t, o)
            const q = state.requests[state.requests.length - 1]
            q.path = '/v1/chat/completions'
            q.body = { model: 'other' }
            return r
        }
        expect((await byId('models').run(ctx)).verdict).toBe('fail')
    })
})

describe('effort', () => {
    const levels = (l: string[]): ChatFrame => ({
        type: 'models',
        models: [{ value: 'mock/m0', label: 'm0', description: '', effortLevels: l }],
    })
    function setup(l: string[], carry: boolean) {
        const { ctx, chat, state } = fakeCtx({})
        chat.frames.push(levels(l))
        const base = chat.send.bind(chat)
        chat.send = async (text, o) => {
            const r = await base(text, o)
            state.requests[state.requests.length - 1].body = carry
                ? { reasoning_effort: chat.effortSet.at(-1) }
                : { text }
            return r
        }
        return { ctx, chat }
    }
    test('applies: gap without effort', () => {
        expect(byId('effort').applies(target({ effort: false }))?.verdict).toBe('gap')
    })
    test('passes when the request carries the level', async () => {
        const { ctx, chat } = setup(['low', 'high'], true)
        const out = await byId('effort').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.effortSet).toEqual(['high'])
    })
    test('fails when the level is not in the request', async () => {
        const out = await byId('effort').run(setup(['low', 'high'], false).ctx)
        expect(out.verdict).toBe('fail')
        expect(out.detail).toContain('reasoning effort field absent')
    })
    test('opencode on a mock ignores models that are not the mock\'s own', async () => {
        const { ctx, chat } = fakeCtx({})
        chat.frames.push({
            type: 'models',
            models: [{ value: 'opencode/free', label: 'f', description: '', effortLevels: ['low', 'high'] }],
        })
        const out = await byId('effort').run(ctx)
        expect(out.verdict).toBe('skip')
    })
    test('never proves off: a model whose only level is off skips', async () => {
        const out = await byId('effort').run(setup(['off'], true).ctx)
        expect(out.verdict).toBe('skip')
    })
    test('picks the last level that is not off', async () => {
        const { ctx, chat } = setup(['low', 'high', 'off'], true)
        const out = await byId('effort').run(ctx)
        expect(out.verdict).toBe('pass')
        expect(chat.effortSet).toEqual(['high'])
    })
    test('skips when no model lists levels', async () => {
        const out = await byId('effort').run(setup([], false).ctx)
        expect(out.verdict).toBe('skip')
    })
})

describe('write fixtures name the backend\'s real tool and order the reply first', () => {
    const fx = (backend: string) =>
        (byId('permission-allow').mockFixtures as (t: BenchTarget) => any[])({
            ...target(),
            backend,
        } as BenchTarget)

    test('the reply is first and the call matches only before a tool result', () => {
        for (const b of ['claude', 'opencode', 'cline', 'goose']) {
            const [first, second] = fx(b)
            expect(first.match.toolCallId).toBe('toolu_bench_write')
            expect(second.match.hasToolResult).toBe(false)
        }
        expect(fx('gemini')[0].match.hasToolResult).toBe(true)
    })
    test('opencode writes with `path`, cline with apply_patch, gemini with write_file', () => {
        const call = (b: string) => fx(b)[1].response.toolCalls[0]
        expect(call('opencode').name).toBe('write')
        expect(call('opencode').arguments.path).toBe('notes/new.md')
        expect(call('opencode').arguments.filePath).toBeUndefined()
        expect(call('cline').name).toBe('apply_patch')
        expect(call('cline').arguments.input).toContain('*** Add File: notes/new.md')
        expect(call('gemini').name).toBe('write_file')
        expect(call('gemini').arguments.file_path).toBe('notes/new.md')
        expect(call('claude').name).toBe('Write')
        expect(call('goose').name).toBe('write')
        expect(call('goose').arguments).toEqual({ path: 'notes/new.md', content: expect.any(String) })
    })
})

describe('write fixtures for the ACP adapters and hermes', () => {
    const call = (backend: string) =>
        (byId('permission-allow').mockFixtures as (t: BenchTarget) => any[])({
            ...target(),
            backend,
        } as BenchTarget)[1].response.toolCalls[0]
    test('claude-code-acp writes with Write, not the generic write', () => {
        expect(call('claude-code-acp').name).toBe('Write')
        expect(call('claude-code-acp').arguments.file_path).toBe('notes/new.md')
    })
    test('codex-acp escalates an exec_command, which is what makes codex ask', () => {
        const c = call('codex-acp')
        expect(c.name).toBe('exec_command')
        expect(c.arguments.sandbox_permissions).toBe('require_escalated')
        expect(c.arguments.cmd).toContain('notes/new.md')
    })
    test('hermes writes with write_file {path, content}', () => {
        expect(call('hermes').name).toBe('write_file')
        expect(call('hermes').arguments.path).toBe('notes/new.md')
    })
})

describe('instructionSignature reads an agent-mode marker', () => {
    const sys = { role: 'system', content: 'same prompt' }
    const user = { role: 'user', content: 'say ok' }
    const reminder = {
        role: 'user',
        content: '<system-reminder>\nYou are in Plan mode. Do not edit.</system-reminder>',
    }
    test('opencode 2.3 inserts a plan-mode reminder and keeps the system prompt: signatures differ', () => {
        const base = instructionSignature({ messages: [sys, user] })
        const switched = instructionSignature({ messages: [sys, reminder, user] })
        expect(switched).not.toBe(base)
    })
    test('the reminder stays in a resumed history, so the signature is stable', () => {
        const a = instructionSignature({ messages: [sys, reminder, user] })
        const b = instructionSignature({ messages: [sys, reminder, user, { role: 'assistant', content: 'ok' }, user] })
        expect(b).toBe(a)
    })
    test('a resumed history holding a plan marker then a later build marker differs from the plan one', () => {
        const build = {
            role: 'user',
            content: '<system-reminder>\nYou are in Build mode. Edit freely.</system-reminder>',
        }
        const plan = instructionSignature({ messages: [sys, reminder, user] })
        const resumed = instructionSignature({ messages: [sys, reminder, user, build, user] })
        expect(resumed).not.toBe(plan)
    })
    test('a mode marker repeated in a resumed history of the same mode keeps the signature', () => {
        const plan = { messages: [sys, reminder, user] }
        const resumed = {
            messages: [sys, reminder, user, reminder, user],
        }
        expect(instructionSignature(resumed)).toBe(instructionSignature(plan))
    })
    test('an ordinary system-reminder (not a mode switch) does not count', () => {
        const other = { role: 'user', content: '<system-reminder>today is monday</system-reminder>' }
        expect(instructionSignature({ messages: [sys, other, user] })).toBe(
            instructionSignature({ messages: [sys, user] }),
        )
    })
})
