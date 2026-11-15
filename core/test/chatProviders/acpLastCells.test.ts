// core/test/chatProviders/acpLastCells.test.ts
// The ACP driver's per-agent behaviour, through the real driver against ../support/fakeLastCellsAcp.ts
// posing as each agent: goose model refusals and per-model effort levels, the chat's permission mode
// reaching claude-code-acp / codex-acp / hermes, an empty openclaw turn and a hermes failure reply
// ending as an error, openclaw's model list and its resumed gateway key, and gemini's trusted spawn.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { ACP_AGENTS, openclawSessionKey } from '../../src/chatProviders/acp/agents'
import {
    ACP_NO_PROGRESS_LOCAL_MS,
    ACP_NO_PROGRESS_MS,
    acpNoProgressMs,
    localModelEntries,
} from '../../src/chatProviders/acp/driver'
import {
    modelEntries,
    parseModelList,
    thoughtLevels,
} from '../../src/chatProviders/acp/openclawModels'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { tempDir } from '../helpers'

const SCRIPT = join(import.meta.dir, '..', 'support', 'fakeLastCellsAcp.ts')

type Line = { method: string; params: Record<string, unknown> }
type Backend = keyof typeof CHAT_BACKENDS

let dir: string
let cwd: string
let savedEnv: Record<string, string | undefined>
const chats: { backend: Backend; id: string }[] = []

const select = (id: string, category: string, current: string, values: string[]) => ({
    id,
    category,
    type: 'select',
    currentValue: current,
    options: values.map(value => ({ value, name: value })),
})

/** A stub for `name` on PATH: logs argv and env, answers `models`/`sessions` itself, else runs the fake. */
function stub(name: string, lc: object = {}): void {
    const p = join(dir, name)
    writeFileSync(
        p,
        `#!/bin/bash
echo "$@" >> ${JSON.stringify(join(dir, `${name}.argv`))}
env > ${JSON.stringify(join(dir, `${name}.env`))}
if [ "$1" = models ]; then cat ${JSON.stringify(join(dir, 'models.json'))}; exit 0; fi
if [ "$1" = sessions ]; then exit 0; fi
exec bun run ${JSON.stringify(SCRIPT)} "$@"
`,
    )
    chmodSync(p, 0o755)
    process.env.FAKE_LC = JSON.stringify(lc)
    process.env.PATH = `${dir}:${savedEnv.PATH}`
}

const requests = (): Line[] => {
    const f = join(dir, 'log.jsonl')
    return existsSync(f)
        ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
        : []
}
const argv = (name: string): string[] => {
    const f = join(dir, `${name}.argv`)
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []
}

async function until(cond: () => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms
    while (!cond() && Date.now() < end) await Bun.sleep(25)
    expect(cond()).toBe(true)
}

async function open(backend: Backend, id: string, cwdOverride = cwd) {
    chats.push({ backend, id })
    const c = makeChatFrameCollector()
    CHAT_BACKENDS[backend].openSession({ chatId: id, cwd: cwdOverride, sink: c.sink })
    await c.waitFor(f => f.type === 'session')
    return c
}

async function turn(backend: Backend, id: string, c: ReturnType<typeof makeChatFrameCollector>) {
    CHAT_BACKENDS[backend].sendMessage({ chatId: id, cwd, sink: c.sink, text: 'hi' })
    await c.waitFor(f => f.type === 'done')
}

const modeCalls = () =>
    requests()
        .filter(l => l.method === 'session/set_mode')
        .map(l => l.params.modeId)

beforeEach(() => {
    savedEnv = {
        PATH: process.env.PATH,
        FAKE_LC: process.env.FAKE_LC,
        FAKE_LC_LOG: process.env.FAKE_LC_LOG,
        OPENCLAW_STATE_DIR: process.env.OPENCLAW_STATE_DIR,
        BISMUTH_ACP_NO_PROGRESS_MS: process.env.BISMUTH_ACP_NO_PROGRESS_MS,
    }
    dir = tempDir('acp-last-cells-')
    cwd = tempDir('acp-last-cells-cwd-')
    process.env.FAKE_LC_LOG = join(dir, 'log.jsonl')
    process.env.OPENCLAW_STATE_DIR = join(dir, 'openclaw-state')
    writeFileSync(
        join(dir, 'models.json'),
        'Gateway is not running.\n' +
            JSON.stringify({
                count: 2,
                models: [
                    { key: 'mock/mock', name: 'Mock', tags: ['default'] },
                    { key: 'mock/mock-2', name: 'Mock 2', tags: [] },
                ],
            }),
    )
})

afterEach(() => {
    for (const c of chats.splice(0)) CHAT_BACKENDS[c.backend].closeChat(c.id)
    for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
})

describe('goose on a local model', () => {
    const local = {
        env: {},
        args: [],
        model: 'm1',
        lm: { url: 'http://x', model: 'm1', apiKey: '' },
        models: ['m1', 'm2'],
    } as never
    const shape = {
        shape: 'new' as const,
        models: ['a', 'b', 'm1'].map(value => ({
            value,
            label: value,
            description: '',
            effortLevels: ['low', 'high'],
        })),
        currentModelId: 'm1',
        modelConfigId: 'model',
        effortConfigId: 'thinking_effort',
    }

    test('the models frame lists the local ids, with the current model carrying its levels', () => {
        expect(localModelEntries(local, shape)).toEqual([
            { value: 'm1', label: 'm1', description: '', effortLevels: ['low', 'high'] },
            { value: 'm2', label: 'm2', description: '', effortLevels: [] },
        ])
    })

    test('a pick the local server cannot serve is refused with the current model, and sends nothing', async () => {
        const server = Bun.serve({
            port: 0,
            fetch: () => Response.json({ data: [{ id: 'm1' }, { id: 'm2' }] }),
        })
        writeFileSync(
            join(cwd, '.settings'),
            `localModel:\n  enabled: true\n  url: http://127.0.0.1:${server.port}\n  model: 'm1'\n`,
        )
        stub('goose', {
            modes: ['auto', 'approve'],
            options: [
                select('model', 'model', 'm1', ['m1', 'm2', 'gpt-4-turbo']),
                select('thinking_effort', 'thought_level', 'off', ['off']),
            ],
            reply: {
                m2: [
                    select('model', 'model', 'm2', ['m1', 'm2', 'gpt-4-turbo']),
                    select('thinking_effort', 'thought_level', 'low', ['off', 'low', 'high']),
                ],
            },
        })
        try {
            const c = await open('goose', 'lc-goose')
            const models = c.frames.find(f => f.type === 'models')
            expect(models?.type === 'models' && models.models.map(m => m.value)).toEqual(['m1', 'm2'])
            CHAT_BACKENDS.goose.setModel?.('lc-goose', 'gpt-4-turbo')
            await c.waitFor(f => f.type === 'model-refused')
            const refused = c.frames.find(f => f.type === 'model-refused')
            expect(refused).toEqual({ type: 'model-refused', model: 'gpt-4-turbo', current: 'm1' })
            expect(requests().filter(l => l.method === 'session/set_config_option')).toEqual([])
            // A switch the server can serve reports its own levels, and the frame carries them.
            CHAT_BACKENDS.goose.setModel?.('lc-goose', 'm2')
            await until(() =>
                c.frames.some(
                    f =>
                        f.type === 'models' &&
                        f.models.find(m => m.value === 'm2')?.effortLevels.join() === 'off,low,high',
                ),
            )
        } finally {
            await server.stop(true)
        }
    }, 20_000)
})

describe('the chat permission mode reaches the agent', () => {
    test('claude-code-acp takes the chat mode names as session modes', async () => {
        stub('npx', { modes: ['default', 'acceptEdits', 'plan', 'dontAsk', 'bypassPermissions'] })
        const c = await open('claude-code-acp', 'lc-cc')
        CHAT_BACKENDS['claude-code-acp'].setPermissionMode?.('lc-cc', 'acceptEdits')
        CHAT_BACKENDS['claude-code-acp'].setPermissionMode?.('lc-cc', 'bypassPermissions')
        await turn('claude-code-acp', 'lc-cc', c)
        expect(modeCalls()).toEqual(['default', 'acceptEdits', 'bypassPermissions'])
    })

    test('codex-acp is read-only by default, workspace-write on acceptEdits and agent under bypass', async () => {
        stub('npx', { modes: ['read-only', 'workspace-write', 'agent', 'agent-full-access'] })
        const c = await open('codex-acp', 'lc-cx')
        CHAT_BACKENDS['codex-acp'].setPermissionMode?.('lc-cx', 'acceptEdits')
        CHAT_BACKENDS['codex-acp'].setPermissionMode?.('lc-cx', 'bypassPermissions')
        await turn('codex-acp', 'lc-cx', c)
        expect(modeCalls()).toEqual(['read-only', 'workspace-write', 'agent'])
    })

    test('hermes is default, accept_edits on acceptEdits, then dont_ask under bypass', async () => {
        stub('hermes', { modes: ['default', 'accept_edits', 'dont_ask'] })
        const c = await open('hermes', 'lc-hm')
        CHAT_BACKENDS.hermes.setPermissionMode?.('lc-hm', 'acceptEdits')
        CHAT_BACKENDS.hermes.setPermissionMode?.('lc-hm', 'bypassPermissions')
        await turn('hermes', 'lc-hm', c)
        expect(modeCalls()).toEqual(['default', 'accept_edits', 'dont_ask'])
    })

    test('a resumed chat whose load reply lists no modes still gets set_mode', async () => {
        stub('hermes', { modes: ['default', 'accept_edits', 'dont_ask'], loadNoModes: true })
        chats.push({ backend: 'hermes', id: 'lc-hm-resume' })
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.hermes.resumeSession({
            chatId: 'lc-hm-resume',
            cwd,
            sink: c.sink,
            sessionId: 'old-session',
        })
        await c.waitFor(f => f.type === 'session')
        CHAT_BACKENDS.hermes.setPermissionMode?.('lc-hm-resume', 'bypassPermissions')
        await turn('hermes', 'lc-hm-resume', c)
        expect(modeCalls()).toEqual(['default', 'dont_ask'])
    })

    test('a mode the agent does not list is not sent', async () => {
        stub('npx', { modes: ['default'] })
        const c = await open('claude-code-acp', 'lc-cc2')
        CHAT_BACKENDS['claude-code-acp'].setPermissionMode?.('lc-cc2', 'plan')
        await turn('claude-code-acp', 'lc-cc2', c)
        expect(modeCalls()).toEqual(['default'])
    })
})

describe('a turn that failed but ended normally', () => {
    const text = (t: string) => ({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: t },
    })

    test('openclaw: no text and no tool call is an error frame and an error result', async () => {
        stub('openclaw', { updates: [] })
        const c = await open('openclaw', 'lc-oc-empty')
        await turn('openclaw', 'lc-oc-empty', c)
        const err = c.frames.find(f => f.type === 'error')
        expect(err?.type === 'error' && err.message).toContain('OpenClaw ended the turn without a reply')
        expect(c.frames.find(f => f.type === 'result')).toMatchObject({ isError: true })
    })

    test('openclaw: a reply is not an error', async () => {
        stub('openclaw', { updates: [text('hello')] })
        const c = await open('openclaw', 'lc-oc-ok')
        await turn('openclaw', 'lc-oc-ok', c)
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
        expect(c.frames.find(f => f.type === 'result')).toMatchObject({ isError: false })
    })

    test('an agent without the flag treats an empty turn as a normal end', async () => {
        stub('hermes', { updates: [] })
        const c = await open('hermes', 'lc-hm-empty')
        await turn('hermes', 'lc-hm-empty', c)
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
    })

    test('hermes: a reply that starts with a failure prefix is an error frame carrying it', async () => {
        const msg = 'API call failed after 3 retries: HTTP 500: bench injected failure'
        stub('hermes', { updates: [text(msg)] })
        const c = await open('hermes', 'lc-hm-fail')
        await turn('hermes', 'lc-hm-fail', c)
        const err = c.frames.find(f => f.type === 'error')
        expect(err?.type === 'error' && err.message).toBe(msg)
        expect(c.frames.find(f => f.type === 'result')).toMatchObject({ isError: true })
    })

    test('hermes: a plain reply, or one that merely mentions the prefix, is not an error', async () => {
        stub('hermes', { updates: [text('Note: API call failed after 3 retries earlier, fixed now')] })
        const c = await open('hermes', 'lc-hm-fine')
        await turn('hermes', 'lc-hm-fine', c)
        expect(c.frames.some(f => f.type === 'error')).toBe(false)
    })
})

describe('openclaw models and effort', () => {
    const options = [select('thought_level', 'thought_level', 'off', ['off', 'low', 'high'])]

    test('the models frame comes from `openclaw models list --json`, with the bridge thought levels', async () => {
        stub('openclaw', { options })
        const c = await open('openclaw', 'lc-oc-models')
        const frame = c.frames.find(f => f.type === 'models')
        expect(frame?.type === 'models' && frame.models).toEqual([
            { value: 'mock/mock', label: 'Mock', description: '', effortLevels: ['off', 'low', 'high'] },
            { value: 'mock/mock-2', label: 'Mock 2', description: '', effortLevels: ['off', 'low', 'high'] },
        ])
        expect(argv('openclaw')).toContain('models list --json')
        CHAT_BACKENDS.openclaw.setEffort?.('lc-oc-models', 'high')
        await until(() => requests().some(l => l.method === 'session/set_config_option'))
        expect(requests().find(l => l.method === 'session/set_config_option')?.params).toMatchObject({
            configId: 'thought_level',
            value: 'high',
        })
    })

    test('a model switch its bridge cannot forward is refused, and the current model is not', async () => {
        stub('openclaw', { options })
        const c = await open('openclaw', 'lc-oc-refuse')
        CHAT_BACKENDS.openclaw.setModel?.('lc-oc-refuse', 'mock/mock')
        CHAT_BACKENDS.openclaw.setModel?.('lc-oc-refuse', 'mock/mock-2')
        await c.waitFor(f => f.type === 'model-refused')
        expect(c.frames.filter(f => f.type === 'model-refused')).toEqual([
            { type: 'model-refused', model: 'mock/mock-2', current: 'mock/mock' },
        ])
        expect(requests().filter(l => l.method === 'session/set_config_option')).toEqual([])
    })

    test('openclaw parks a shell approval its bridge asks for and forwards the answer', async () => {
        for (const behavior of ['allow', 'deny'] as const) {
            const id = `lc-oc-perm-${behavior}`
            stub('openclaw', { permission: true })
            const c = await open('openclaw', id)
            CHAT_BACKENDS.openclaw.sendMessage({ chatId: id, cwd, sink: c.sink, text: 'run it' })
            const frame = await c.waitFor(f => f.type === 'permission')
            expect(frame).toMatchObject({ type: 'permission', toolName: 'exec' })
            CHAT_BACKENDS.openclaw.respondPermission?.(id, (frame as { id: string }).id, behavior)
            await c.waitFor(f => f.type === 'done')
            const answered = requests().filter(l => l.method === 'permission-answer').pop()
            expect(answered?.params.optionId).toBe(behavior === 'allow' ? 'allow_once' : 'deny')
        }
        expect(CHAT_BACKENDS.openclaw.setPermissionMode).toBeUndefined()
    })

    test('parsers: text before the JSON, the default tag, and a lone model', () => {
        expect(parseModelList('x\n{"models":[{"key":"a/b","name":"B"}]}')).toEqual({
            models: [{ key: 'a/b', name: 'B' }],
            current: 'a/b',
        })
        expect(parseModelList('not json')).toEqual({ models: [], current: null })
        expect(thoughtLevels({ configOptions: [select('t', 'thought_level', 'off', ['off'])] })).toEqual({
            id: 't',
            levels: [],
        })
        expect(modelEntries({ models: [{ key: 'k', name: 'K' }], current: 'k' }, ['low'])[0]).toMatchObject({
            value: 'k',
            effortLevels: ['low'],
        })
    })

    test('adaptive is not an effort level', () => {
        const opts = { configOptions: [select('t', 'thought_level', 'adaptive', ['off', 'low', 'high', 'adaptive'])] }
        expect(thoughtLevels(opts)).toEqual({ id: 't', levels: ['off', 'low', 'high'] })
        const only = { configOptions: [select('t', 'thought_level', 'adaptive', ['off', 'adaptive'])] }
        expect(thoughtLevels(only)).toEqual({ id: 't', levels: [] })
    })
})

describe('openclaw resume binds the original gateway key', () => {
    test('the session frame reports the gateway key, and a resumed chat spawns with it', async () => {
        stub('openclaw', {})
        const first = await open('openclaw', 'lc-oc-first')
        const session = first.frames.find(f => f.type === 'session')
        const key = openclawSessionKey('lc-oc-first')
        expect(session?.type === 'session' && session.sessionId).toBe(key)
        expect(argv('openclaw')).toContain(`acp --session ${key}`)

        chats.push({ backend: 'openclaw', id: 'lc-oc-second' })
        const second = makeChatFrameCollector()
        CHAT_BACKENDS.openclaw.resumeSession({
            chatId: 'lc-oc-second',
            cwd,
            sink: second.sink,
            sessionId: key,
        })
        await second.waitFor(f => f.type === 'session')
        expect(argv('openclaw').filter(l => l.startsWith('acp --session'))).toEqual([
            `acp --session ${key}`,
            `acp --session ${key}`,
        ])
        const load = requests().find(l => l.method === 'session/load')
        expect(load?.params).toMatchObject({ sessionId: key, _meta: { sessionKey: key } })
        const again = second.frames.find(f => f.type === 'session')
        expect(again?.type === 'session' && again.sessionId).toBe(key)
    })

    test('a resume from an old session id (not a gateway key) falls back to the new chat key', async () => {
        stub('openclaw', {})
        chats.push({ backend: 'openclaw', id: 'lc-oc-legacy' })
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.openclaw.resumeSession({
            chatId: 'lc-oc-legacy',
            cwd,
            sink: c.sink,
            sessionId: 'some-bridge-uuid',
        })
        await c.waitFor(f => f.type === 'session')
        expect(argv('openclaw')).toContain(`acp --session ${openclawSessionKey('lc-oc-legacy')}`)
    })

    test('a private resumed chat erases the first chat key', async () => {
        stub('openclaw', {})
        const key = openclawSessionKey('lc-oc-orig')
        chats.push({ backend: 'openclaw', id: 'lc-oc-priv' })
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.openclaw.resumeSession({ chatId: 'lc-oc-priv', cwd, sink: c.sink, sessionId: key })
        await c.waitFor(f => f.type === 'session')
        CHAT_BACKENDS.openclaw.setPrivate?.('lc-oc-priv', true)
        CHAT_BACKENDS.openclaw.closeChat('lc-oc-priv')
        await until(() => argv('openclaw').some(l => l.startsWith('sessions delete')))
        expect(argv('openclaw')).toContain(`sessions delete ${key} --yes`)
    })
})

describe('gemini spawns trusting the chat vault', () => {
    test('GEMINI_CLI_TRUST_WORKSPACE is set, and a user value wins', async () => {
        expect(ACP_AGENTS.find(a => a.id === 'gemini')?.spawnEnv).toEqual({
            GEMINI_CLI_TRUST_WORKSPACE: 'true',
        })
        stub('gemini', { options: [] })
        await open('gemini', 'lc-gem')
        expect(readFileSync(join(dir, 'gemini.env'), 'utf8')).toContain('GEMINI_CLI_TRUST_WORKSPACE=true')
        CHAT_BACKENDS.gemini.closeChat('lc-gem')
        process.env.GEMINI_CLI_TRUST_WORKSPACE = 'false'
        try {
            await open('gemini', 'lc-gem2')
            expect(readFileSync(join(dir, 'gemini.env'), 'utf8')).toContain('GEMINI_CLI_TRUST_WORKSPACE=false')
        } finally {
            delete process.env.GEMINI_CLI_TRUST_WORKSPACE
        }
    })
})

describe('a silent turn ends with an error', () => {
    const tool = { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run', kind: 'execute', status: 'in_progress' }
    const send = (backend: Backend, id: string, c: ReturnType<typeof makeChatFrameCollector>) =>
        CHAT_BACKENDS[backend].sendMessage({ chatId: id, cwd, sink: c.sink, text: 'hi' })

    test('an agent that sends nothing is stopped with its name and the seconds, and told to cancel', async () => {
        process.env.BISMUTH_ACP_NO_PROGRESS_MS = '400'
        stub('gemini', { hang: true })
        const c = await open('gemini', 'lc-silent')
        send('gemini', 'lc-silent', c)
        const err = await c.waitFor(f => f.type === 'error')
        expect(err).toMatchObject({ type: 'error' })
        expect((err as { message: string }).message).toMatch(/^Gemini CLI sent nothing for \d+ s, so the turn was stopped/)
        await c.waitFor(f => f.type === 'done')
        // the cancel is written to the agent's stdin and logged by the stub asynchronously, so wait for it
        const deadline = Date.now() + 5000
        while (!requests().some(l => l.method === 'session/cancel') && Date.now() < deadline) await Bun.sleep(25)
        expect(requests().some(l => l.method === 'session/cancel')).toBe(true)
    })

    test('a running tool is not silence', async () => {
        process.env.BISMUTH_ACP_NO_PROGRESS_MS = '300'
        stub('gemini', { hang: true, updates: [tool] })
        const c = await open('gemini', 'lc-tool')
        send('gemini', 'lc-tool', c)
        await c.waitFor(f => f.type === 'tool-use')
        await Bun.sleep(1200)
        expect(c.frames.some(f => f.type === 'error' || f.type === 'done')).toBe(false)
    })

    test('an open permission card is not silence, and answering it restarts the window', async () => {
        process.env.BISMUTH_ACP_NO_PROGRESS_MS = '300'
        stub('openclaw', { permission: true })
        const c = await open('openclaw', 'lc-card')
        send('openclaw', 'lc-card', c)
        const frame = await c.waitFor(f => f.type === 'permission')
        await Bun.sleep(1200)
        expect(c.frames.some(f => f.type === 'error' || f.type === 'done')).toBe(false)
        CHAT_BACKENDS.openclaw.respondPermission?.('lc-card', (frame as { id: string }).id, 'allow')
        await c.waitFor(f => f.type === 'done')
        // openclaw's own empty-reply error may follow; the stop is what must not.
        expect(JSON.stringify(c.frames)).not.toContain('sent nothing')
    })

    test('the window is 120 s, and a local model gets ten minutes', () => {
        delete process.env.BISMUTH_ACP_NO_PROGRESS_MS
        expect(acpNoProgressMs(false)).toBe(ACP_NO_PROGRESS_MS)
        expect(acpNoProgressMs(true)).toBe(ACP_NO_PROGRESS_LOCAL_MS)
        expect(ACP_NO_PROGRESS_MS).toBe(120_000)
    })
})
