// core/test/chatProviders/acpConfigFakeAgent.test.ts
// The ACP driver's config calls, through the real driver against ../support/fakeConfigAcp.ts posing
// as goose: model, effort and mode calls run in order and the prompt waits for them; effort is sent
// again after a model switch; the mode follows the chat's permission mode; a turn sent while a
// resume loads carries the resumed session id.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { buildMcpServers } from '../../src/chatProviders/acp/driver'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { tempDir } from '../helpers'

const SCRIPT = join(import.meta.dir, '..', 'support', 'fakeConfigAcp.ts')

type Line = { method: string; params: Record<string, unknown> }

let logFile: string
let cwd: string
let savedPath: string | undefined
let savedCline: string | undefined
const chats: string[] = []

function stub(name: string): void {
    const dir = tempDir('fake-config-acp-bin-')
    const p = join(dir, name)
    writeFileSync(p, `#!/bin/bash\nexec bun run ${JSON.stringify(SCRIPT)} "$@"\n`)
    chmodSync(p, 0o755)
    process.env.PATH = `${dir}:${savedPath}`
}

function lines(): Line[] {
    if (!existsSync(logFile)) return []
    return readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
}

async function until(cond: () => boolean, ms = 10_000): Promise<void> {
    const end = Date.now() + ms
    while (!cond() && Date.now() < end) await Bun.sleep(25)
    expect(cond()).toBe(true)
}

const after = (ls: Line[], method: string) => ls.map(l => l.method).lastIndexOf(method)

beforeEach(() => {
    savedPath = process.env.PATH
    savedCline = process.env.CLINE_DIR
    logFile = join(tempDir('fake-config-acp-log-'), 'log.jsonl')
    process.env.FAKE_CONFIG_ACP_LOG = logFile
    cwd = tempDir('fake-config-acp-cwd-')
})

afterEach(() => {
    for (const id of chats.splice(0)) {
        CHAT_BACKENDS.goose.closeChat(id)
        CHAT_BACKENDS.cline.closeChat(id)
    }
    process.env.PATH = savedPath
    if (savedCline === undefined) delete process.env.CLINE_DIR
    else process.env.CLINE_DIR = savedCline
})

async function openGoose(id: string) {
    stub('goose')
    chats.push(id)
    const c = makeChatFrameCollector()
    CHAT_BACKENDS.goose.openSession({ chatId: id, cwd, sink: c.sink })
    await c.waitFor(f => f.type === 'session')
    return c
}

describe('goose config calls', () => {
    test('model, then effort, then the prompt, with effort sent again after the switch', async () => {
        const c = await openGoose('cfg-order')
        CHAT_BACKENDS.goose.setEffort?.('cfg-order', 'max')
        CHAT_BACKENDS.goose.setModel?.('cfg-order', 'm2')
        CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-order', cwd, sink: c.sink, text: 'hi' })
        await c.waitFor(f => f.type === 'done')
        const calls = lines()
            .filter(l => l.method === 'session/set_config_option' || l.method === 'session/prompt')
            .map(l => (l.method === 'session/prompt' ? 'prompt' : `${l.params.configId}=${l.params.value}`))
        expect(calls).toEqual(['thinking_effort=max', 'model=m2', 'thinking_effort=max', 'prompt'])
    })

    test('a default chat runs in approve, set before the first prompt', async () => {
        const c = await openGoose('cfg-ask')
        CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-ask', cwd, sink: c.sink, text: 'hi' })
        await c.waitFor(f => f.type === 'done')
        const ls = lines()
        const modes = ls.filter(l => l.method === 'session/set_mode')
        expect(modes.map(l => l.params.modeId)).toEqual(['approve'])
        expect(after(ls, 'session/set_mode')).toBeLessThan(after(ls, 'session/prompt'))
    })

    test('the chat permission mode picks goose approve or auto, and the manifest reports it', async () => {
        const c = await openGoose('cfg-mode')
        CHAT_BACKENDS.goose.setPermissionMode?.('cfg-mode', 'bypassPermissions')
        CHAT_BACKENDS.goose.setPermissionMode?.('cfg-mode', 'plan')
        CHAT_BACKENDS.goose.setPermissionMode?.('cfg-mode', 'bypassPermissions')
        CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-mode', cwd, sink: c.sink, text: 'hi' })
        await c.waitFor(f => f.type === 'done')
        const ls = lines()
        expect(ls.filter(l => l.method === 'session/set_mode').map(l => l.params.modeId)).toEqual([
            'approve',
            'auto',
            'approve',
            'auto',
        ])
        expect(after(ls, 'session/set_mode')).toBeLessThan(after(ls, 'session/prompt'))
        const reported = c.frames.flatMap(f => (f.type === 'manifest' ? [f.manifest.permissionMode] : []))
        expect(reported.at(-1)).toBe('bypassPermissions')
    })

    test('a turn sent while a resume loads carries the resumed session id', async () => {
        stub('goose')
        chats.push('cfg-resume')
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.goose.resumeSession?.({ chatId: 'cfg-resume', cwd, sink: c.sink, sessionId: 'old-1' })
        // The session is registered while its load (400 ms in the fake) is still pending.
        await until(() => lines().some(l => l.method === 'initialize'))
        CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-resume', cwd, sink: c.sink, text: 'hi' })
        await c.waitFor(f => f.type === 'done')
        const ls = lines()
        const load = ls.find(l => l.method === 'session/load')
        expect(load?.params.sessionId).toBe('old-1')
        const prompt = ls.find(l => l.method === 'session/prompt')
        expect(prompt?.params.sessionId).toBe('old-1')
        expect(ls.some(l => l.method === 'session/new')).toBe(false)
    })
})

describe('an adapter that gives up retrying the model server', () => {
    test('the turn ends with one error frame and the next turn runs', async () => {
        process.env.FAKE_CONFIG_ACP_RETRY = '1'
        try {
            const c = await openGoose('cfg-retry')
            CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-retry', cwd, sink: c.sink, text: 'hi' })
            await c.waitFor(f => f.type === 'done')
            const errors = c.frames.filter(f => f.type === 'error')
            expect(errors.length).toBe(1)
            expect(errors[0].type === 'error' && errors[0].message).toBe('the model server is down')
            delete process.env.FAKE_CONFIG_ACP_RETRY
            c.frames.length = 0
            CHAT_BACKENDS.goose.sendMessage({ chatId: 'cfg-retry', cwd, sink: c.sink, text: 'again' })
            await until(() => c.frames.some(f => f.type === 'done'))
        } finally {
            delete process.env.FAKE_CONFIG_ACP_RETRY
        }
    })
})

describe('cline MCP wiring', () => {
    test('with CLINE_DIR unset a cline spawn writes nothing under the real HOME', async () => {
        // The incident: a cline spawn created ~/.cline/data/settings/cline_mcp_settings.json on the
        // user's machine. Without CLINE_DIR the driver leaves cline's own dir alone.
        const fakeHome = tempDir('fake-cline-home-')
        const savedHome = process.env.HOME
        delete process.env.CLINE_DIR
        process.env.HOME = fakeHome
        try {
            stub('cline')
            chats.push('cfg-cline-home')
            const c = makeChatFrameCollector()
            CHAT_BACKENDS.cline.openSession({
                chatId: 'cfg-cline-home',
                cwd,
                sink: c.sink,
            })
            await c.waitFor(f => f.type === 'session')
            CHAT_BACKENDS.cline.sendMessage({
                chatId: 'cfg-cline-home',
                cwd,
                sink: c.sink,
                text: 'hi',
            })
            await until(() => c.frames.some(f => f.type === 'done'))
            expect(readdirSync(fakeHome)).toEqual([])
        } finally {
            if (savedHome === undefined) delete process.env.HOME
            else process.env.HOME = savedHome
        }
    })

    test('cline spawn writes the Bismuth server into CLINE_DIR', async () => {
        const expected = buildMcpServers(cwd)[0]
        if (!expected) return // no installed MCP server on this machine
        const dir = tempDir('fake-cline-dir-')
        process.env.CLINE_DIR = dir
        stub('cline')
        chats.push('cfg-cline')
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.cline.openSession({ chatId: 'cfg-cline', cwd, sink: c.sink })
        await c.waitFor(f => f.type === 'session')
        const file = join(dir, 'data', 'settings', 'cline_mcp_settings.json')
        await until(() => existsSync(file))
        const parsed = JSON.parse(readFileSync(file, 'utf8'))
        expect(parsed.mcpServers.bismuth.command).toBe(expected.command)
        expect(parsed.mcpServers.bismuth.env.BISMUTH_VAULT).toBe(cwd)
    })
})
