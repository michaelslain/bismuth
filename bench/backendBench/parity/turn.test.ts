// bench/backendBench/parity/turn.test.ts
// Each turn scenario against a fake ScenarioCtx: it passes on what a working backend produces and
// fails, with a useful detail, on the broken shape its past bug produced. No backend is spawned.
import { describe, expect, test } from 'bun:test'
import type { ChatFrame } from '../../../core/src/chat'
import type {
    BenchTarget,
    ChatDriver,
    ModelRequest,
    ScenarioCtx,
    TurnResult,
} from '../types'
import scenarios, { BACKEND_TOOLS, mcpCall, requestToolNames, shellCall } from './turn'

const SENTINEL = 'bismuth-sentinel-7Q4Z'

const target = (over: Partial<BenchTarget['caps']> = {}): BenchTarget =>
    ({
        label: 'claude@mock',
        backend: 'claude',
        source: { kind: 'mock' },
        binary: '/bin/claude',
        caps: { streaming: 'delta', mcp: 'cli', sessionPicker: true, ...over },
    }) as unknown as BenchTarget

const scenario = (id: string) => {
    const s = scenarios.find(x => x.id === id)
    if (!s) throw new Error(`no scenario ${id}`)
    return s
}

function result(over: Partial<TurnResult> & { frames?: ChatFrame[] }): TurnResult {
    const frames = over.frames ?? []
    return {
        frames,
        text: frames
            .filter(f => f.type === 'assistant-text')
            .map(f => (f as { text: string }).text)
            .join(''),
        toolUses: [],
        error: null,
        firstTokenMs: frames.some(f => f.type === 'assistant-text') ? 5 : null,
        wallMs: 100,
        ended: 'done',
        ...over,
    }
}

const text = (t: string): ChatFrame => ({ type: 'assistant-text', text: t })
const end: ChatFrame[] = [
    { type: 'result', isError: false, numTurns: 1, costUsd: null },
    { type: 'done' },
]

function fakeCtx(opts: {
    turns: TurnResult[]
    requests?: ModelRequest[]
    target?: BenchTarget
    chatFrames?: ChatFrame[]
}): ScenarioCtx {
    const turns = [...opts.turns]
    const driver = {
        frames: opts.chatFrames ?? [],
        open: async () => {},
        send: async () => turns.shift() ?? result({ ended: 'timeout' }),
    } as unknown as ChatDriver
    return {
        target: opts.target ?? target(),
        vault: '/tmp/none',
        newChat: async () => driver,
        modelRequests: () => opts.requests ?? [],
        log: () => {},
    } as unknown as ScenarioCtx
}

const req = (body: unknown): ModelRequest => ({
    path: '/v1/messages',
    body,
    estTokens: 1000,
    at: 0,
})

const GOOD_BODY = {
    system: 'You are replying in a Bismuth chat tab. LaTeX math with KaTeX. You are Quill. The `bismuth` CLI does everything Bismuth does. skills: bench-skill',
    messages: [{ role: 'user', content: 'parity-instructions: who are you?' }],
    tools: [{ name: 'mcp__bismuth__bismuth_cli' }],
}

describe('ids', () => {
    test('the six parity ids', () => {
        expect(scenarios.map(s => s.id)).toEqual([
            'reply',
            'stream',
            'tool-bismuth',
            'instructions',
            'error-readable',
            'title',
        ])
        expect(scenarios.every(s => s.suite === 'parity')).toBe(true)
    })
    test('mockFixtures resolve per target and name the backend tool', () => {
        const tool = scenario('tool-bismuth')
        const fx = (b: string) =>
            JSON.stringify(
                (tool.mockFixtures as (t: BenchTarget) => unknown[])({
                    ...target(),
                    backend: b,
                } as BenchTarget),
            )
        expect(fx('claude')).toContain('"Bash"')
        expect(fx('opencode')).toContain('"shell"')
        expect(fx('opencode')).not.toContain('"bash"')
        expect(fx('codex')).toContain('"exec_command"')
        expect(fx('codex')).toContain('"cmd"')
        expect(fx('goose')).toContain('bismuth__bismuth_cli')
    })
})

describe('reply', () => {
    const s = scenario('reply')
    test('passes on a normal turn', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ frames: [text('Hi'), ...end] })] }))
        expect(o.verdict).toBe('pass')
    })
    test('fails on an error frame', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ error: 'boom', ended: 'error' })] }))
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('boom')
    })
    test('fails on done with no text', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ frames: end })] }))
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('empty text')
    })
})

describe('stream', () => {
    const s = scenario('stream')
    test('passes with deltas', async () => {
        const frames = [text('a'), text('b'), text('c'), ...end]
        expect((await s.run(fakeCtx({ turns: [result({ frames })] }))).verdict).toBe('pass')
    })
    test('fails when the reply arrives as one frame', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ frames: [text('abc'), ...end] })] }))
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('1 assistant-text')
    })
    test('skips a non-delta backend', () => {
        expect(s.applies(target({ streaming: 'part' }))?.verdict).toBe('skip')
    })
})

describe('tool-bismuth', () => {
    const s = scenario('tool-bismuth')
    const use = (result?: string, isError = false) =>
        fakeCtx({
            turns: [
                result_({ toolUses: [{ id: 't', name: 'Bash', input: {}, result, isError }] }),
            ],
        })
    const result_ = (o: Partial<TurnResult>) => result({ frames: [text('ok'), ...end], ...o })
    test('passes when the sentinel comes back', async () => {
        expect((await s.run(use(`# ${SENTINEL}`))).verdict).toBe('pass')
    })
    test('fails with no tool-use', async () => {
        const o = await s.run(fakeCtx({ turns: [result_({})] }))
        expect(o.detail).toContain('no tool-use')
    })
    test('fails when the result is an error', async () => {
        const o = await s.run(use('command not found', true))
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('isError')
    })
})

describe('instructions', () => {
    const s = scenario('instructions')
    const run = (body: unknown, t = target()) =>
        s.run(
            fakeCtx({
                turns: [result({ frames: [text('Noted'), ...end] })],
                requests: [req(body)],
                target: t,
            }),
        )
    test('passes when everything is there', async () => {
        expect((await run(GOOD_BODY)).verdict).toBe('pass')
    })
    test('fails when the daemon name is missing (bug 7)', async () => {
        const o = await run({ ...GOOD_BODY, system: GOOD_BODY.system.replace('Quill', 'Claude') })
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('daemon name quill')
    })
    test('fails when only the persona line is present, not the rendering note', async () => {
        const o = await run({
            ...GOOD_BODY,
            system: GOOD_BODY.system.replace('LaTeX math with KaTeX. ', ''),
        })
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('chat rendering note')
    })
    test('fails when the MCP tool is missing', async () => {
        const o = await run({ ...GOOD_BODY, tools: [{ name: 'Bash' }] })
        expect(o.detail).toContain('Bismuth MCP tool')
    })
    test('an MCP-less backend needs no MCP tool or skill', async () => {
        const t = { ...target({ mcp: 'none' }), backend: 'goose' } as BenchTarget
        expect((await run({ ...GOOD_BODY, tools: [] }, t)).verdict).toBe('pass')
    })
    test('fails with no request at all', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ frames: end })] }))
        expect(o.detail).toContain('no request')
    })
    test('skips a cloud target', () => {
        const t = { ...target(), source: { kind: 'cloud' } } as BenchTarget
        expect(s.applies(t)?.verdict).toBe('skip')
    })
})

describe('error-readable', () => {
    const s = scenario('error-readable')
    const ok = result({ frames: [text('Back'), ...end] })
    test('passes on a readable error then a working turn', async () => {
        const bad = result({ error: 'The model server failed (500).', ended: 'error' })
        expect((await s.run(fakeCtx({ turns: [bad, ok] }))).verdict).toBe('pass')
    })
    test('fails when no error frame arrives', async () => {
        const o = await s.run(fakeCtx({ turns: [result({ ended: 'timeout' })] }))
        expect(o.detail).toContain('no error frame')
    })
    test('fails on a stack trace', async () => {
        const bad = result({ error: 'Error: x\n    at foo (/a/b.ts:1:2)', ended: 'error' })
        expect((await s.run(fakeCtx({ turns: [bad, ok] }))).detail).toContain('stack')
    })
    test('fails when the next turn is dead', async () => {
        const bad = result({ error: 'The model server failed.', ended: 'error' })
        const dead = result({ ended: 'timeout' })
        expect((await s.run(fakeCtx({ turns: [bad, dead] }))).detail).toContain('next turn')
    })
})

describe('title', () => {
    const s = scenario('title')
    const turns = [result({ frames: [text('a'), ...end] }), result({ frames: [text('b'), ...end] })]
    test('passes with a title frame', async () => {
        const o = await s.run(fakeCtx({ turns, chatFrames: [{ type: 'title', title: 'Trip' }] }))
        expect(o.verdict).toBe('pass')
    })
    test('fails without one', async () => {
        const o = await s.run(fakeCtx({ turns, chatFrames: [] }))
        expect(o.detail).toContain('no title frame')
    })
})

describe('harness fixes from the first matrix', () => {
    test('instructions: an MCP tool deferred into the prompt text counts', async () => {
        const body = {
            ...GOOD_BODY,
            system: `${GOOD_BODY.system} deferred: mcp__bismuth__bismuth_cli`,
            tools: [{ name: 'Bash' }, { name: 'ToolSearch' }],
        }
        const o = await scenario('instructions').run(
            fakeCtx({
                turns: [result({ frames: [text('Noted'), ...end] })],
                requests: [req(body)],
            }),
        )
        expect(o.verdict).toBe('pass')
    })
    test('error-readable: an error result with assistant text is a surfaced error', async () => {
        const bad = result({
            error: 'API Error: 500 mock upstream failure',
            frames: [text('API Error: 500 mock upstream failure'), { type: 'result', isError: true, numTurns: 1, costUsd: null }, { type: 'done' }],
        })
        const good = result({ frames: [text('Back again.'), ...end] })
        const o = await scenario('error-readable').run(fakeCtx({ turns: [bad, good] }))
        expect(o.verdict).toBe('pass')
    })
    test('tool-bismuth: allows the permission a shell tool asks', async () => {
        let allowed: string | null = null
        const driver = {
            frames: [],
            open: async () => {},
            send: async (_t: string, o?: { onFrame?: (f: ChatFrame, d: unknown) => void }) => {
                o?.onFrame?.(
                    { type: 'permission', id: 'p1', toolName: 'Bash' } as unknown as ChatFrame,
                    { respondPermission: (id: string) => (allowed = id) },
                )
                return result({
                    frames: end,
                    toolUses: [{ name: 'Bash', result: SENTINEL, isError: false }] as never,
                })
            },
        } as unknown as ChatDriver
        const ctx = { ...fakeCtx({ turns: [] }), newChat: async () => driver } as ScenarioCtx
        const o = await scenario('tool-bismuth').run(ctx)
        expect(allowed).toBe('p1')
        expect(o.verdict).toBe('pass')
    })
})

describe('fixture order and the real tool names', () => {
    const fixtures = (id: string, backend: string) =>
        (scenario(id).mockFixtures as (t: BenchTarget) => any[])({
            ...target(),
            backend,
        } as BenchTarget)

    test('tool-bismuth: the result reply is listed first, the call only before a tool result', () => {
        for (const b of ['claude', 'opencode', 'codex', 'cline']) {
            const [first, second] = fixtures('tool-bismuth', b)
            expect(first.match.toolCallId).toBe('toolu_parity_sentinel')
            expect(first.response.content).toBeDefined()
            expect(second.match.hasToolResult).toBe(false)
            expect(second.response.toolCalls).toHaveLength(1)
        }
    })
    test('tool-bismuth: gemini has no call id, so its reply matches on the request shape', () => {
        const [first, second] = fixtures('tool-bismuth', 'gemini')
        expect(first.match).toEqual({ userMessage: 'parity-tool', hasToolResult: true })
        expect(second.match.hasToolResult).toBe(false)
        expect(second.response.toolCalls[0].name).toBe('run_shell_command')
    })
    test('the shell table names each backend\'s real tool', () => {
        expect(shellCall('claude', 'x')?.name).toBe('Bash')
        expect(shellCall('opencode', 'x')?.name).toBe('shell')
        expect(shellCall('codex', 'x')).toEqual({ name: 'exec_command', arguments: { cmd: 'x' } })
        expect(shellCall('cline', 'x')).toBeNull()
    })
    test('error-readable: the recovery fixture precedes the 500 fixture', () => {
        const fx = scenario('error-readable').mockFixtures as any[]
        expect(fx[0].match.userMessage).toBe('parity-recover')
        expect(fx[1].match.userMessage).toBe('parity-fail')
    })
    test('stream: the fixture spreads the reply over time', () => {
        const [fx] = scenario('stream').mockFixtures as any[]
        expect(fx.latency).toBeGreaterThanOrEqual(20)
        expect(fx.chunkSize).toBeGreaterThan(0)
    })
    test('stream: two text frames pass, one fails', async () => {
        const s = scenario('stream')
        const two = [text('a'), text('b'), ...end]
        expect((await s.run(fakeCtx({ turns: [result({ frames: two })] }))).verdict).toBe('pass')
        const one = [text('ab'), ...end]
        expect((await s.run(fakeCtx({ turns: [result({ frames: one })] }))).verdict).toBe('fail')
    })
})

describe('tool names are read per wire shape', () => {
    test('Anthropic and Responses `name`, OpenAI `function.name`, Gemini declarations', () => {
        expect(requestToolNames({ tools: [{ name: 'Bash' }] })).toEqual(['Bash'])
        expect(
            requestToolNames({ tools: [{ type: 'function', function: { name: 'apply_patch' } }] }),
        ).toEqual(['apply_patch'])
        expect(
            requestToolNames({
                tools: [{ functionDeclarations: [{ name: 'write_file' }, { name: 'glob' }] }],
            }),
        ).toEqual(['write_file', 'glob'])
        expect(requestToolNames(null)).toEqual([])
    })
    test('instructions: a cline OpenAI-shaped list with the Bismuth tool passes and lists no "none"', async () => {
        const s = scenario('instructions')
        const body = JSON.parse(JSON.stringify(GOOD_BODY))
        body.tools = [{ type: 'function', function: { name: 'bismuth__bismuth_cli' } }]
        const o = await s.run(
            fakeCtx({
                turns: [result({ frames: [text('Noted'), ...end] })],
                requests: [req(body)],
                target: { ...target(), backend: 'cline' } as BenchTarget,
            }),
        )
        expect(o.verdict).toBe('pass')
    })
    test('instructions: the failure label names the tools instead of "none"', async () => {
        const s = scenario('instructions')
        const body = JSON.parse(JSON.stringify(GOOD_BODY))
        body.tools = [{ functionDeclarations: [{ name: 'write_file' }] }]
        const o = await s.run(
            fakeCtx({
                turns: [result({ frames: [text('Noted'), ...end] })],
                requests: [req(body)],
                target: { ...target(), backend: 'gemini' } as BenchTarget,
            }),
        )
        expect(o.verdict).toBe('fail')
        expect(o.detail).toContain('write_file')
        expect(o.detail).not.toContain('tools: none')
    })
})

describe('the ACP adapters and hermes name their real tools', () => {
    const fixtures = (id: string, backend: string) =>
        (scenario(id).mockFixtures as (t: BenchTarget) => any[])({
            ...target(),
            backend,
        } as BenchTarget)
    const call = (id: string, backend: string) => fixtures(id, backend)[1].response.toolCalls[0]

    test('claude-code-acp and hermes call Bismuth as mcp__bismuth__bismuth_cli', () => {
        expect(call('tool-bismuth', 'claude-code-acp').name).toBe('mcp__bismuth__bismuth_cli')
        expect(call('tool-bismuth', 'hermes').name).toBe('mcp__bismuth__bismuth_cli')
        expect(mcpCall('claude').name).toBe('mcp__bismuth__bismuth_cli')
        // every other MCP backend keeps the bare name
        expect(mcpCall('goose').name).toBe('bismuth__bismuth_cli')
    })
    test('codex-acp reaches Bismuth through exec_command, as codex does', () => {
        expect(shellCall('codex-acp', 'x')).toEqual({ name: 'exec_command', arguments: { cmd: 'x' } })
        expect(call('tool-bismuth', 'codex-acp').name).toBe('exec_command')
        expect(call('tool-bismuth', 'codex-acp').arguments.cmd).toBe('bismuth read notes/sentinel.md')
    })
    test('codex-acp writes with an escalated exec_command, and quotes the content', () => {
        const w = BACKEND_TOOLS['codex-acp'].write!('notes/new.md', "it's")
        expect(w.name).toBe('exec_command')
        const a = w.arguments as Record<string, string>
        expect(a.sandbox_permissions).toBe('require_escalated')
        expect(a.cmd).toBe(`printf '%s' 'it'\\''s' > 'notes/new.md'`)
        expect(a.justification).toContain('notes/new.md')
    })
    test('claude-code-acp writes with Write and hermes with write_file', () => {
        expect(BACKEND_TOOLS['claude-code-acp'].write!('p', 'c')).toEqual({
            name: 'Write',
            arguments: { file_path: 'p', content: 'c' },
        })
        expect(BACKEND_TOOLS.hermes.write!('p', 'c')).toEqual({
            name: 'write_file',
            arguments: { path: 'p', content: 'c' },
        })
    })
})
