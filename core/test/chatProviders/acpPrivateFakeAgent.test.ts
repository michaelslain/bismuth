// core/test/chatProviders/acpPrivateFakeAgent.test.ts
// A PRIVATE conversation's teardown through the real ACP driver, against the fake agent: with the
// chat's private toggle on (setPrivate), `session/delete` is sent while the agent still runs, the
// process is gone before the eraser runs, and the eraser removes what the agent left on disk.
//
// Stub-binary pattern as in acpResumeFakeAgent.test.ts: an executable named after the agent's binary
// (`goose`, `npx`) is prepended onto PATH so the real driver spawns the fake. Zero network.
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import {
    makeAcpFakeAgentStubDir,
    pidAlive,
    waitForPidFile,
    waitProcessesGone,
} from '../support/acpFakeAgentProcess'
import { shouldRunSlowTests } from '../slowGate'
import { tempDir } from '../helpers'

const FAKE_AGENT_SCRIPT = join(import.meta.dir, '..', 'support', 'fakeAcpAgent.ts')

type EchoLine = { method?: string; params?: Record<string, unknown> }
const readEcho = (path: string): EchoLine[] => {
    try {
        return readFileSync(path, 'utf8')
            .split('\n')
            .filter(Boolean)
            .flatMap(l => {
                try {
                    return [JSON.parse(l) as EchoLine]
                } catch {
                    return []
                }
            })
    } catch {
        return []
    }
}
const until = async (ok: () => boolean, ms = 10_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
        if (ok()) return true
        await new Promise(r => setTimeout(r, 50))
    }
    return false
}

const describeOrSkipSlow = shouldRunSlowTests(process.env) ? describe : describe.skip

describeOrSkipSlow('a private ACP chat erases itself on close (fake agent)', () => {
    const ENV_KEYS = [
        'PATH',
        'FAKE_ACP_ECHO_FILE',
        'FAKE_ACP_MODEL_SHAPE',
        'FAKE_ACP_AUTH_GATE',
        'FAKE_ACP_PROMPT_HOLD',
        'XDG_STATE_HOME',
        'CLAUDE_CONFIG_DIR',
    ] as const
    const saved: Record<string, string | undefined> = {}
    const temps: string[] = []
    const pids: number[] = []
    let echoFile = ''
    let pidFile = ''

    beforeEach(() => {
        for (const k of ENV_KEYS) saved[k] = process.env[k]
        const work = tempDir('bismuth-acp-private-')
        temps.push(work)
        echoFile = join(work, 'echo.jsonl')
        pidFile = join(work, 'agent.pid')
        process.env.FAKE_ACP_ECHO_FILE = echoFile
        process.env.FAKE_ACP_MODEL_SHAPE = 'new'
        delete process.env.FAKE_ACP_AUTH_GATE
        delete process.env.FAKE_ACP_PROMPT_HOLD
    })

    afterEach(async () => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
        const alive = await waitProcessesGone(pids.splice(0))
        for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
        if (alive.length) throw new Error(`fake agent pid(s) ${alive.join(', ')} survived closeChat`)
    }, 15_000)

    afterAll(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
    })

    function stub(binary: string): void {
        const dir = makeAcpFakeAgentStubDir('bismuth-acp-private-stub-', binary, FAKE_AGENT_SCRIPT, pidFile)
        temps.push(dir)
        process.env.PATH = `${dir}:${saved.PATH ?? ''}`
    }

    test('goose: session/delete is sent, then the request logs from the chat are removed', async () => {
        stub('goose')
        const state = tempDir('bismuth-acp-private-state-')
        temps.push(state)
        process.env.XDG_STATE_HOME = state
        const chatId = 'goose-1'
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.goose.openSession({ chatId, cwd: state, sink: c.sink })
        await c.waitFor(f => f.type === 'session')
        const pid = await waitForPidFile(pidFile)
        pids.push(pid)
        expect(readEcho(echoFile).some(l => l.method === 'session/new')).toBe(true)

        const log = join(state, 'goose', 'logs', 'llm_request.abc.jsonl')
        mkdirSync(join(log, '..'), { recursive: true })
        writeFileSync(log, '{"prompt":"secret"}')

        CHAT_BACKENDS.goose.setPrivate(chatId, true)
        CHAT_BACKENDS.goose.closeChat(chatId)
        expect(await until(() => readEcho(echoFile).some(l => l.method === 'session/delete'))).toBe(true)
        const del = readEcho(echoFile).find(l => l.method === 'session/delete')!
        expect(typeof del.params?.sessionId).toBe('string')
        expect(await until(() => !existsSync(log))).toBe(true)
        expect(pidAlive(pid)).toBe(false)
    }, 20_000)

    test('claude-code-acp: the transcript of a private conversation is erased', async () => {
        stub('npx')
        const claude = tempDir('bismuth-acp-private-claude-')
        temps.push(claude)
        process.env.CLAUDE_CONFIG_DIR = claude
        const chatId = 'cca-1'
        const c = makeChatFrameCollector()
        CHAT_BACKENDS['claude-code-acp'].openSession({ chatId, cwd: claude, sink: c.sink })
        const frame = await c.waitFor(f => f.type === 'session')
        pids.push(await waitForPidFile(pidFile))

        const sessionId = frame.type === 'session' ? frame.sessionId : ''
        const transcript = join(claude, 'projects', '-vault', `${sessionId}.jsonl`)
        mkdirSync(join(transcript, '..'), { recursive: true })
        writeFileSync(transcript, 'secret')

        CHAT_BACKENDS['claude-code-acp'].setPrivate(chatId, true)
        CHAT_BACKENDS['claude-code-acp'].closeChat(chatId)
        expect(await until(() => !existsSync(transcript))).toBe(true)
    }, 20_000)

    test('the toggle turned back off keeps the conversation', async () => {
        stub('npx')
        const claude = tempDir('bismuth-acp-private-off-')
        temps.push(claude)
        process.env.CLAUDE_CONFIG_DIR = claude
        const chatId = 'cca-2'
        const c = makeChatFrameCollector()
        CHAT_BACKENDS['claude-code-acp'].openSession({ chatId, cwd: claude, sink: c.sink })
        const frame = await c.waitFor(f => f.type === 'session')
        pids.push(await waitForPidFile(pidFile))
        const sessionId = frame.type === 'session' ? frame.sessionId : ''
        const transcript = join(claude, 'projects', '-vault', `${sessionId}.jsonl`)
        mkdirSync(join(transcript, '..'), { recursive: true })
        writeFileSync(transcript, 'kept')

        CHAT_BACKENDS['claude-code-acp'].setPrivate(chatId, true)
        CHAT_BACKENDS['claude-code-acp'].setPrivate(chatId, false)
        CHAT_BACKENDS['claude-code-acp'].closeChat(chatId)
        await new Promise(r => setTimeout(r, 1500))
        expect(existsSync(transcript)).toBe(true)
    }, 20_000)

    test('a chat that is not private sends no session/delete', async () => {
        stub('goose')
        const chatId = 'goose-2'
        const c = makeChatFrameCollector()
        CHAT_BACKENDS.goose.openSession({ chatId, cwd: tempDir('bismuth-acp-normal-'), sink: c.sink })
        await c.waitFor(f => f.type === 'session')
        pids.push(await waitForPidFile(pidFile))
        CHAT_BACKENDS.goose.closeChat(chatId)
        await new Promise(r => setTimeout(r, 500))
        const lines = readEcho(echoFile)
        expect(lines.some(l => l.method === 'session/delete')).toBe(false)
    }, 20_000)
})
