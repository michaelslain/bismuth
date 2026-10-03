// core/test/chatProviders/acpLocalModel.test.ts
// The vault's `localModel` setting reaches an ACP agent's spawn env — goose only; every other ACP
// agent ignores it. The agent is a stub binary that records its own environment to a file before
// exec'ing the fake ACP agent, so the assertion is on what the driver REALLY handed to spawn.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
    chmodSync,
    existsSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { localUnreachableMessage } from '../../src/agentBackends/localModelProbe'
import {
    acceptsModelPick,
    acpSpawnEnv,
} from '../../src/chatProviders/acp/driver'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { tempDir } from '../helpers'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { waitProcessesGone } from '../support/acpFakeAgentProcess'
import { shouldRunSlowTests } from '../slowGate'

const FAKE_AGENT_SCRIPT = join(
    import.meta.dir,
    '..',
    'support',
    'fakeAcpAgent.ts',
)

const fakeLocal = (env: Record<string, string>) =>
    ({
        env,
        args: [],
        model: 'm',
        lm: { url: 'http://x', model: 'm', apiKey: '' },
        models: ['m'],
    }) as never

describe('acpSpawnEnv', () => {
    test('merges the local env over the base', () => {
        expect(
            acpSpawnEnv({ A: '1', B: '2' }, fakeLocal({ B: 'x', C: '3' })),
        ).toEqual({ A: '1', B: 'x', C: '3' })
    })
    test('is a no-op on null', () => {
        const base = { A: '1' }
        expect(acpSpawnEnv(base, null)).toEqual({ A: '1' })
    })
})

describe('acceptsModelPick (a local chat is pinned to the server models)', () => {
    test('a remembered cloud id is refused while local is on', () => {
        expect(acceptsModelPick(fakeLocal({}), 'claude-sonnet-4-5')).toBe(false)
    })
    test('a listed id is accepted, bare or local/-prefixed', () => {
        expect(acceptsModelPick(fakeLocal({}), 'm')).toBe(true)
        expect(acceptsModelPick(fakeLocal({}), 'local/m')).toBe(true)
    })
    test('with local off any id passes', () => {
        expect(acceptsModelPick(null, 'claude-sonnet-4-5')).toBe(true)
    })
})

const describeOrSkipSlow = shouldRunSlowTests(process.env)
    ? describe
    : describe.skip

describeOrSkipSlow('ACP spawn env from the localModel setting', () => {
    let savedPath: string | undefined
    let stubDir: string
    let outDir: string
    let vault: string
    let server: ReturnType<typeof Bun.serve> | null = null
    let serverUrl = ''
    const chatIds: { backend: 'goose' | 'cline'; id: string }[] = []
    const pids: number[] = []

    function writeStub(name: string): void {
        const p = join(stubDir, name)
        writeFileSync(
            p,
            `#!/bin/bash\necho $$ >> ${JSON.stringify(join(outDir, 'pids'))}\nenv > ${JSON.stringify(join(outDir, 'env'))}\nexec bun run ${JSON.stringify(FAKE_AGENT_SCRIPT)} "$@"\n`,
        )
        chmodSync(p, 0o755)
    }

    function setting(url: string, model: string): void {
        writeFileSync(
            join(vault, '.settings'),
            `localModel:\n  enabled: true\n  url: ${url}\n  model: '${model}'\n`,
        )
    }

    beforeEach(() => {
        savedPath = process.env.PATH
        stubDir = tempDir('bismuth-acplm-stub-')
        outDir = tempDir('bismuth-acplm-out-')
        vault = tempDir('bismuth-acplm-vault-')
        server = Bun.serve({
            port: 0,
            fetch: () => Response.json({ data: [{ id: 'm' }] }),
        })
        serverUrl = `http://127.0.0.1:${server.port}`
        writeStub('goose')
        writeStub('cline')
        process.env.PATH = `${stubDir}:${savedPath ?? ''}`
    })

    afterEach(async () => {
        for (const c of chatIds.splice(0))
            CHAT_BACKENDS[c.backend].closeChat(c.id)
        if (savedPath === undefined) delete process.env.PATH
        else process.env.PATH = savedPath
        await server?.stop(true)
        server = null
        const pidFile = join(outDir, 'pids')
        if (existsSync(pidFile))
            for (const l of readFileSync(pidFile, 'utf8').split('\n'))
                if (Number(l) > 0) pids.push(Number(l))
        const alive = await waitProcessesGone(pids.splice(0))
        for (const d of [stubDir, outDir, vault])
            rmSync(d, { recursive: true, force: true })
        if (alive.length > 0) throw new Error(`pid(s) ${alive} still alive`)
    }, 30_000)

    async function waitForFile(p: string): Promise<string> {
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
            if (existsSync(p)) {
                const t = readFileSync(p, 'utf8')
                if (t.includes('PATH=')) return t
            }
            await new Promise(r => setTimeout(r, 50))
        }
        throw new Error('stub never recorded its env')
    }

    test('goose spawns with the OpenAI-compatible env', async () => {
        setting(serverUrl, 'm')
        const chatId = 'goose-lm-' + Date.now()
        chatIds.push({ backend: 'goose', id: chatId })
        const { sink } = makeChatFrameCollector(20_000)
        CHAT_BACKENDS.goose.openSession({ chatId, cwd: vault, sink })
        const env = await waitForFile(join(outDir, 'env'))
        expect(env).toContain('GOOSE_PROVIDER=openai')
        expect(env).toContain(`OPENAI_HOST=${serverUrl}`)
        expect(env).toContain('GOOSE_MODEL=m')
    }, 30_000)

    test('an unreachable server emits the error frame and spawns nothing', async () => {
        const dead = Bun.serve({ port: 0, fetch: () => new Response('x') })
        const url = `http://127.0.0.1:${dead.port}`
        await dead.stop(true)
        setting(url, '')
        const chatId = 'goose-lm-down-' + Date.now()
        chatIds.push({ backend: 'goose', id: chatId })
        const { sink, waitFor } = makeChatFrameCollector(20_000)
        CHAT_BACKENDS.goose.openSession({ chatId, cwd: vault, sink })
        const err = await waitFor(f => f.type === 'error')
        if (err.type === 'error')
            expect(err.message).toBe(localUnreachableMessage(url))
        expect(existsSync(join(outDir, 'env'))).toBe(false)
        expect(CHAT_BACKENDS.goose.hasSession(chatId)).toBe(false)
    }, 30_000)

    test('cline ignores the setting entirely', async () => {
        setting(serverUrl, 'm')
        const chatId = 'cline-lm-' + Date.now()
        chatIds.push({ backend: 'cline', id: chatId })
        const { sink } = makeChatFrameCollector(20_000)
        CHAT_BACKENDS.cline.openSession({ chatId, cwd: vault, sink })
        const env = await waitForFile(join(outDir, 'env'))
        expect(env).not.toContain('GOOSE_PROVIDER')
        expect(env).not.toContain(`OPENAI_HOST=${serverUrl}`)
    }, 30_000)
})
