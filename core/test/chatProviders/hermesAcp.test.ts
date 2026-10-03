// core/test/chatProviders/hermesAcp.test.ts
// Hermes Agent as an ACP backend: the spawn-table entry, the catalog identity, the registry entry,
// and one full turn through CHAT_BACKENDS.hermes against the fake ACP agent (a stub binary NAMED
// `hermes` that execs fakeAcpAgent.ts — same pattern as acpFakeAgent.test.ts). Hermes is NOT
// installed on the machine this was authored on, so the real CLI is never exercised.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { backendOf, can } from '../../src/agentBackends/catalog'
import { ACP_AGENTS } from '../../src/chatProviders/acp/agents'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { tempDir } from '../helpers'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import {
    makeAcpFakeAgentStubDir,
    waitForPidFile,
    waitProcessesGone,
} from '../support/acpFakeAgentProcess'
import { shouldRunSlowTests } from '../slowGate'

const FAKE_AGENT_SCRIPT = join(
    import.meta.dir,
    '..',
    'support',
    'fakeAcpAgent.ts',
)

describe('hermes catalog + spawn table', () => {
    test('ACP_AGENTS carries `hermes acp`', () => {
        const spec = ACP_AGENTS.find(a => a.id === 'hermes')
        expect(spec).toMatchObject({
            id: 'hermes',
            binary: 'hermes',
            args: ['acp'],
        })
    })
    test('catalog identity + no local-model mechanism', () => {
        expect(backendOf('hermes').label).toBe('Hermes Agent')
        expect(can('hermes', 'localModel')).toBe(false)
    })
    test('registered in CHAT_BACKENDS', () => {
        expect(CHAT_BACKENDS.hermes.id).toBe('hermes')
    })
})

const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

describeOrSkipSlow('a full turn through CHAT_BACKENDS.hermes', () => {
    let stubDir: string
    let pidDir: string
    let pidFile: string
    let savedPath: string | undefined
    const chatIds: string[] = []
    const pids: number[] = []

    beforeEach(() => {
        savedPath = process.env.PATH
        pidDir = tempDir('bismuth-hermes-pid-')
        pidFile = join(pidDir, 'agent.pid')
        stubDir = makeAcpFakeAgentStubDir(
            'bismuth-hermes-stub-',
            'hermes',
            FAKE_AGENT_SCRIPT,
            pidFile,
        )
        process.env.PATH = `${stubDir}:${savedPath ?? ''}`
    })

    afterEach(async () => {
        for (const id of chatIds.splice(0)) CHAT_BACKENDS.hermes.closeChat(id)
        if (savedPath === undefined) delete process.env.PATH
        else process.env.PATH = savedPath
        const alive = await waitProcessesGone(pids.splice(0))
        rmSync(stubDir, { recursive: true, force: true })
        rmSync(pidDir, { recursive: true, force: true })
        if (alive.length > 0)
            throw new Error(`hermes fake agent pid(s) ${alive} still alive`)
    }, 30_000)

    test('produces an assistant-text frame', async () => {
        const chatId = 'hermes-fake-' + Date.now()
        chatIds.push(chatId)
        const { sink, waitFor } = makeChatFrameCollector(24_000)
        CHAT_BACKENDS.hermes.sendMessage({
            chatId,
            cwd: '/tmp',
            sink,
            text: 'hello',
        })
        pids.push(await waitForPidFile(pidFile))
        const text = await waitFor(f => f.type === 'assistant-text')
        if (text.type === 'assistant-text')
            expect(text.text).toBe('Hello from the fake ACP agent')
        await waitFor(f => f.type === 'done')
    }, 30_000)
})
