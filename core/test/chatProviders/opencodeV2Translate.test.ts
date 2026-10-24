// opencode 2's event, model, command and integration shapes → Bismuth's frames and lists. The
// event fixtures are trimmed from a live opencode 2.0.32 `GET /api/event` capture.
import { describe, expect, test } from 'bun:test'
import {
    commandEntriesFromV2,
    modelEntriesFromV2Models,
    newOpencodeV2TurnState,
    opencodeV2AttemptStatus,
    opencodeV2EventSessionId,
    opencodeV2Methods,
    opencodeV2ModelRef,
    opencodeV2RetryGiveUp,
    opencodeV2TurnModel,
    effortLevelsFromV2Variants,
    parseOpencodeV2PermissionAsk,
    providerListFromV2,
    translateOpencodeV2Event,
} from '../../src/chatProviders/opencode/opencodeV2Translate'
import { translateOpencodeSessionMessages } from '../../src/chatProviders/opencode/opencodeTranslate'

const S = 'ses_e947f0a8bffeFopMQZifFh75xQ'
const M = 'msg_16b810412001RGh876C1ftUIUP'
const ev = (type: string, data: Record<string, unknown>) => ({
    id: 'evt_x',
    type,
    data: { sessionID: S, ...data },
})

describe('translateOpencodeV2Event', () => {
    test('text deltas stream, and the ended snapshot adds only what never streamed', () => {
        const st = newOpencodeV2TurnState()
        const out = [
            ev('session.text.started', { assistantMessageID: M, ordinal: 0 }),
            ev('session.text.delta', {
                assistantMessageID: M,
                ordinal: 0,
                delta: 'Hel',
            }),
            ev('session.text.delta', {
                assistantMessageID: M,
                ordinal: 0,
                delta: 'lo',
            }),
            ev('session.text.ended', {
                assistantMessageID: M,
                ordinal: 0,
                text: 'Hello world',
            }),
        ].flatMap(e => translateOpencodeV2Event(e, st))
        expect(out).toEqual([
            { type: 'assistant-text', text: 'Hel' },
            { type: 'assistant-text', text: 'lo' },
            { type: 'assistant-text', text: ' world' },
        ])
    })

    test('a part that never streamed renders whole off its ended event, reasoning as thinking', () => {
        const st = newOpencodeV2TurnState()
        expect(
            [
                ev('session.reasoning.ended', {
                    assistantMessageID: M,
                    ordinal: 0,
                    text: 'hmm',
                }),
                ev('session.text.ended', {
                    assistantMessageID: M,
                    ordinal: 1,
                    text: 'done',
                }),
            ].flatMap(e => translateOpencodeV2Event(e, st)),
        ).toEqual([
            { type: 'thinking', text: 'hmm' },
            { type: 'assistant-text', text: 'done' },
        ])
    })

    test('a tool chips on its resolved input and resolves once', () => {
        const st = newOpencodeV2TurnState()
        const id = 'a1599fec-7973-4994-90e7-d257fa46c7a9'
        const out = [
            ev('session.tool.input.started', {
                assistantMessageID: M,
                id,
                name: 'read',
            }),
            ev('session.tool.input.ended', {
                assistantMessageID: M,
                id,
                text: '{"path": "run.out"}',
            }),
            ev('session.tool.called', {
                assistantMessageID: M,
                id,
                input: { path: 'run.out' },
                executed: false,
            }),
            ev('session.tool.success', {
                assistantMessageID: M,
                id,
                content: [{ type: 'text', text: 'Read file run.out' }],
            }),
            ev('session.tool.success', {
                assistantMessageID: M,
                id,
                content: [],
            }),
        ].flatMap(e => translateOpencodeV2Event(e, st))
        expect(out).toEqual([
            { type: 'tool-use', id, name: 'read', input: { path: 'run.out' } },
            {
                type: 'tool-result',
                id,
                content: 'Read file run.out',
                isError: false,
            },
        ])
    })

    test('a declined tool is an error result and marks the turn declined', () => {
        const st = newOpencodeV2TurnState()
        const out = translateOpencodeV2Event(
            ev('session.tool.failed', {
                assistantMessageID: M,
                id: 'call_c',
                error: {
                    type: 'aborted',
                    message: 'The user declined this tool call',
                },
                executed: false,
            }),
            st,
        )
        expect(out).toEqual([
            { type: 'tool-use', id: 'call_c', name: 'tool', input: {} },
            {
                type: 'tool-result',
                id: 'call_c',
                content: 'The user declined this tool call',
                isError: true,
            },
        ])
        expect(st.declined).toBe(true)
    })

    test('step costs sum, and a free step leaves the cost null', () => {
        const st = newOpencodeV2TurnState()
        translateOpencodeV2Event(ev('session.step.ended', { cost: 0 }), st)
        expect(st.costUsd).toBeNull()
        translateOpencodeV2Event(ev('session.step.ended', { cost: 0.25 }), st)
        translateOpencodeV2Event(ev('session.step.ended', { cost: 0.5 }), st)
        expect(st.costUsd).toBe(0.75)
    })

    test('the execution events set the outcome', () => {
        const a = newOpencodeV2TurnState()
        translateOpencodeV2Event(ev('session.execution.succeeded', {}), a)
        expect(a.outcome).toEqual({ kind: 'succeeded' })
        const b = newOpencodeV2TurnState()
        translateOpencodeV2Event(
            ev('session.execution.failed', {
                error: { type: 'provider.auth', message: 'bad key' },
            }),
            b,
        )
        expect(b.outcome).toEqual({ kind: 'failed', message: 'bad key' })
        const c = newOpencodeV2TurnState()
        translateOpencodeV2Event(
            ev('session.execution.interrupted', { reason: 'user' }),
            c,
        )
        expect(c.outcome).toEqual({ kind: 'interrupted', reason: 'user' })
    })

    test('unknown or malformed events yield nothing', () => {
        const st = newOpencodeV2TurnState()
        expect(translateOpencodeV2Event(null, st)).toEqual([])
        expect(
            translateOpencodeV2Event(ev('session.inbox.delivered', {}), st),
        ).toEqual([])
        expect(
            translateOpencodeV2Event({ type: 'session.text.delta' }, st),
        ).toEqual([])
    })
})

test('opencodeV2EventSessionId reads data.sessionID', () => {
    expect(opencodeV2EventSessionId(ev('session.text.delta', {}))).toBe(S)
    expect(
        opencodeV2EventSessionId({ type: 'server.connected', data: {} }),
    ).toBeNull()
})

test('a retry gives up from the fourth attempt', () => {
    const retry = (attempt: number) =>
        ev('session.retry.scheduled', {
            attempt,
            error: { type: 'provider.transport', message: 'ConnectionRefused' },
        })
    expect(opencodeV2RetryGiveUp(retry(2))).toBeNull()
    expect(opencodeV2RetryGiveUp(retry(3))).toBeNull()
    expect(opencodeV2RetryGiveUp(retry(4))).toBe(
        'opencode could not reach the model after 3 attempts: ConnectionRefused',
    )
    expect(opencodeV2RetryGiveUp(ev('session.step.started', {}))).toBeNull()
})

describe('parseOpencodeV2PermissionAsk', () => {
    test('a shell ask shows its command line', () => {
        expect(
            parseOpencodeV2PermissionAsk({
                type: 'permission.asked',
                data: {
                    id: 'per_16b8431cf001sIOU9m3MB6LvNS',
                    sessionID: S,
                    action: 'shell',
                    resources: ['ls -1'],
                    save: ['ls *'],
                    source: { type: 'tool', messageID: M, id: 'call_9' },
                },
            }),
        ).toEqual({
            id: 'per_16b8431cf001sIOU9m3MB6LvNS',
            toolName: 'shell',
            input: { command: 'ls -1' },
        })
    })

    test('any other action shows its resources, and metadata wins when present', () => {
        expect(
            parseOpencodeV2PermissionAsk({
                type: 'permission.asked',
                data: { id: 'p', action: 'edit', resources: ['a.md'] },
            }),
        ).toEqual({ id: 'p', toolName: 'edit', input: { pattern: ['a.md'] } })
        expect(
            parseOpencodeV2PermissionAsk({
                type: 'permission.asked',
                data: {
                    id: 'p',
                    action: 'edit',
                    resources: [],
                    metadata: { filePath: 'a.md' },
                },
            }),
        ).toEqual({ id: 'p', toolName: 'edit', input: { filePath: 'a.md' } })
        expect(
            parseOpencodeV2PermissionAsk({
                type: 'permission.replied',
                data: { id: 'p' },
            }),
        ).toBeNull()
    })
})

test('opencodeV2ModelRef splits on the first slash', () => {
    expect(opencodeV2ModelRef('lmstudio/qwen/qwen3-coder-30b')).toEqual({
        providerID: 'lmstudio',
        id: 'qwen/qwen3-coder-30b',
    })
    expect(opencodeV2ModelRef('nope')).toBeNull()
    expect(opencodeV2ModelRef('a/')).toBeNull()
})

test('models: free off the first cost tier, disabled dropped, shared names disambiguated', () => {
    expect(
        modelEntriesFromV2Models([
            {
                id: 'big-pickle',
                providerID: 'opencode',
                name: 'Big Pickle',
                cost: [{ input: 0, output: 0 }],
                enabled: true,
            },
            {
                id: 'k2',
                providerID: 'moonshot',
                name: 'Kimi',
                cost: [{ input: 1, output: 3 }],
                enabled: true,
            },
            {
                id: 'k2',
                providerID: 'opencode',
                name: 'Kimi',
                cost: [{ input: 1, output: 3 }],
                enabled: true,
            },
            {
                id: 'old',
                providerID: 'acme',
                name: 'Old',
                cost: [],
                enabled: false,
            },
            { id: 'bare', providerID: 'acme' },
        ]),
    ).toEqual([
        {
            value: 'opencode/big-pickle',
            label: 'Big Pickle',
            description: 'opencode/big-pickle',
            effortLevels: [],
            free: true,
        },
        {
            value: 'moonshot/k2',
            label: 'Kimi (moonshot)',
            description: 'moonshot/k2',
            effortLevels: [],
            free: false,
        },
        {
            value: 'opencode/k2',
            label: 'Kimi (opencode)',
            description: 'opencode/k2',
            effortLevels: [],
            free: false,
        },
        {
            value: 'acme/bare',
            label: 'acme/bare',
            description: 'acme/bare',
            effortLevels: [],
        },
    ])
})

test('commands keep one-token names', () => {
    expect(
        commandEntriesFromV2([
            { name: 'init', description: 'guided AGENTS.md setup' },
            { name: 'two words' },
            { name: 'review' },
        ]),
    ).toEqual([
        { name: 'init', description: 'guided AGENTS.md setup' },
        { name: 'review', description: '' },
    ])
})

describe('integrations', () => {
    const openai = {
        id: 'openai',
        name: 'OpenAI',
        methods: [
            { type: 'key' },
            { type: 'env', names: ['OPENAI_API_KEY'] },
            {
                id: 'chatgpt-token-sharing',
                type: 'oauth',
                label: 'Sign in with ChatGPT',
            },
        ],
        connections: [],
    }
    const copilot = {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        methods: [
            { type: 'env', names: ['GITHUB_TOKEN'] },
            {
                id: 'device',
                type: 'oauth',
                label: 'Login with GitHub Copilot',
                form: [
                    { key: 'deploymentType', required: true, type: 'string' },
                ],
            },
        ],
        connections: [],
    }
    const console_ = {
        id: 'opencode',
        name: 'OpenCode Console',
        methods: [
            {
                id: 'device',
                type: 'oauth',
                label: 'OpenCode Console account',
                form: [
                    {
                        key: 'server',
                        hidden: true,
                        default: 'https://opencode.ai/console',
                    },
                ],
            },
        ],
        connections: [],
    }

    test('methods keep keys and fillable OAuth, in order', () => {
        expect(opencodeV2Methods(openai)).toEqual([
            { type: 'api', label: 'API key' },
            {
                type: 'oauth',
                label: 'Sign in with ChatGPT',
                methodId: 'chatgpt-token-sharing',
                answer: null,
            },
        ])
        expect(opencodeV2Methods(copilot)).toEqual([])
        expect(opencodeV2Methods(console_)).toEqual([
            {
                type: 'oauth',
                label: 'OpenCode Console account',
                methodId: 'device',
                answer: { server: 'https://opencode.ai/console' },
            },
        ])
    })

    test('the provider list: connections are connected, drivable ones available, local hidden', () => {
        expect(
            providerListFromV2([
                openai,
                copilot,
                console_,
                {
                    id: 'acme',
                    name: 'Acme',
                    methods: [{ type: 'key' }],
                    connections: [
                        {
                            type: 'credential',
                            id: 'c',
                            label: 'k',
                            method: 'oauth',
                        },
                    ],
                },
                {
                    id: 'groq',
                    name: 'Groq',
                    methods: [{ type: 'key' }],
                    connections: [{ type: 'env', name: 'GROQ_API_KEY' }],
                },
                {
                    id: 'local',
                    name: 'Local',
                    methods: [{ type: 'key' }],
                    connections: [],
                },
            ]),
        ).toEqual({
            connected: [
                { id: 'acme', name: 'Acme', kind: 'oauth' },
                { id: 'groq', name: 'Groq', kind: 'env' },
            ],
            available: [
                {
                    id: 'openai',
                    name: 'OpenAI',
                    methods: [
                        { type: 'api', label: 'API key' },
                        { type: 'oauth', label: 'Sign in with ChatGPT' },
                    ],
                },
                {
                    id: 'opencode',
                    name: 'OpenCode Console',
                    methods: [
                        { type: 'oauth', label: 'OpenCode Console account' },
                    ],
                },
            ],
        })
    })

    test('attempt status', () => {
        expect(opencodeV2AttemptStatus({ status: 'pending' })).toEqual({
            kind: 'pending',
        })
        expect(opencodeV2AttemptStatus({ status: 'complete' })).toEqual({
            kind: 'complete',
        })
        expect(
            opencodeV2AttemptStatus({ status: 'failed', message: 'nope' }),
        ).toEqual({ kind: 'failed', message: 'nope' })
        expect(opencodeV2AttemptStatus({ status: 'expired' })).toEqual({
            kind: 'failed',
            message: 'The sign-in expired.',
        })
    })
})

test('history: opencode 2 messages replay, user images included, idle markers skipped', () => {
    expect(
        translateOpencodeSessionMessages([
            {
                id: 'm1',
                type: 'user',
                text: 'what color',
                files: [
                    {
                        data: 'AAAA',
                        mime: 'image/png',
                        source: { type: 'inline' },
                        name: 'p.png',
                    },
                ],
            },
            {
                id: 'm2',
                type: 'assistant',
                content: [
                    { type: 'reasoning', text: 'look' },
                    { type: 'text', text: 'Red' },
                ],
            },
            { id: 'm3', type: 'idle', outcome: 'succeeded' },
        ]),
    ).toEqual([
        {
            type: 'user-message',
            text: 'what color',
            images: ['data:image/png;base64,AAAA'],
        },
        { type: 'thinking', text: 'look' },
        { type: 'assistant-text', text: 'Red' },
    ])
})

test('effort levels are the variants that set reasoningEffort', () => {
    expect(
        effortLevelsFromV2Variants([
            { id: 'none', settings: { reasoningEffort: 'none' } },
            { id: 'low', settings: { reasoningEffort: 'low' } },
            { id: 'fast', settings: { serviceTier: 'priority' } },
            { id: 'max', settings: { reasoningEffort: 'max' } },
        ]),
    ).toEqual(['none', 'low', 'max'])
    expect(effortLevelsFromV2Variants(undefined)).toEqual([])
})

test('a turn model carries the effort as its variant only when the model lists it', () => {
    expect(
        opencodeV2TurnModel('opencode/flint', 'high', ['low', 'high']),
    ).toEqual({
        providerID: 'opencode',
        id: 'flint',
        variant: 'high',
    })
    expect(
        opencodeV2TurnModel('opencode/flint', 'max', ['low', 'high']),
    ).toEqual({
        providerID: 'opencode',
        id: 'flint',
    })
    expect(opencodeV2TurnModel('opencode/big-pickle', undefined, [])).toEqual({
        providerID: 'opencode',
        id: 'big-pickle',
    })
    expect(opencodeV2TurnModel('nope', 'high', ['high'])).toBeNull()
})
