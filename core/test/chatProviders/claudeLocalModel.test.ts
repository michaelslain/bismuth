// Task 2 of the local-models plan: with `localModel.enabled` in a vault's `.settings`, a REAL `claude`
// binary driven through chat.ts runs its turns against the configured local server (here the mock LLM,
// core/test/support/mockLlm.ts) instead of the user's Anthropic account — and says so loudly when the
// server is unreachable rather than silently falling back to the cloud. Isolation mirrors
// claudeMocked.test.ts (CLAUDE_CONFIG_DIR + cleared Bedrock/Vertex escape hatches).
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    closeChat,
    hasSession,
    newChatId,
    sendMessage,
    setModel,
} from '../../src/chat'
import { localUnreachableMessage } from '../../src/agentBackends/localModelProbe'
import { whichClaude } from '../../src/claudeWhich'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { startMockLlm, type MockLlmHandle } from '../support/mockLlm'
import { shouldRunSlowTests } from '../slowGate'

const HAS_CLAUDE = whichClaude() !== null
const describeLive =
    HAS_CLAUDE && shouldRunSlowTests(process.env) ? describe : describe.skip
const describeFast = HAS_CLAUDE ? describe : describe.skip

const ENV_KEYS = [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'ANTHROPIC_BEDROCK_BASE_URL',
    'ANTHROPIC_VERTEX_BASE_URL',
    'CLAUDE_CONFIG_DIR',
] as const
// Snapshotted before anything that can reject, so afterAll never wipes a real developer env var.
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {}
for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

const tempDirs: string[] = []
const chatIds: string[] = []
let mock: MockLlmHandle | undefined

async function vaultWith(settings: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-claude-local-'))
    tempDirs.push(dir)
    await writeFile(join(dir, '.settings'), settings)
    return dir
}

afterEach(() => {
    for (const id of chatIds.splice(0)) closeChat(id)
})

afterAll(async () => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]
        else process.env[k] = savedEnv[k]
    }
    await mock?.stop()
    for (const dir of tempDirs.splice(0))
        await rm(dir, { recursive: true, force: true }).catch(() => {})
})

type JournalEntry = { path: string; body?: { model?: string } }
async function journal(): Promise<JournalEntry[]> {
    return (await fetch(`${mock!.url}/__aimock/journal`).then(r =>
        r.json(),
    )) as JournalEntry[]
}
const messageModels = (j: JournalEntry[]) =>
    j.filter(e => e.path.startsWith('/v1/messages')).map(e => e.body?.model)

describeLive(
    'claude chat on a local model (mock server, zero account API calls)',
    () => {
        test('turns hit the local server on the configured model, the picker lists the server ids, and a picked id reaches the next turn', async () => {
            // --metrics also exposes the request journal this test reads bodies from.
            mock = await startMockLlm(undefined, ['--metrics'])
            for (const k of ENV_KEYS) delete process.env[k]
            process.env.CLAUDE_CONFIG_DIR = await mkdtemp(
                join(tmpdir(), 'bismuth-claude-config-'),
            )
            tempDirs.push(process.env.CLAUDE_CONFIG_DIR)

            const cwd = await vaultWith(
                `localModel:\n  enabled: true\n  url: ${mock.url}\n  model: mock-local\n`,
            )
            const chatId = newChatId()
            chatIds.push(chatId)
            const { sink, frames, waitFor } = makeChatFrameCollector(60_000)

            await sendMessage(chatId, 'hello', cwd, sink)
            const text = await waitFor(f => f.type === 'assistant-text')
            expect(text.type === 'assistant-text' && text.text).toBe('Hello!')
            await waitFor(f => f.type === 'done')

            // Every /v1/messages request went to the mock on the configured model.
            const first = messageModels(await journal())
            expect(first.length).toBeGreaterThan(0)
            expect(new Set(first)).toEqual(new Set(['mock-local']))

            // The picker lists exactly the server's ids, not Claude's.
            const served = (
                (await fetch(`${mock.url}/v1/models`).then(r => r.json())) as {
                    data: { id: string }[]
                }
            ).data.map(m => m.id)
            const models = await waitFor(f => f.type === 'models')
            expect(
                models.type === 'models' && models.models.map(m => m.value),
            ).toEqual(served)

            // A picked id reaches the next turn's request.
            const picked = served.find(id => id !== 'mock-local')!
            const before = (await journal()).length
            setModel(chatId, picked)
            await sendMessage(chatId, 'hello', cwd, sink)
            await waitFor(
                f =>
                    f.type === 'done' &&
                    frames.filter(x => x.type === 'done').length >= 2,
            )
            const after = messageModels((await journal()).slice(before))
            expect(after).toContain(picked)
        }, 120_000)
    },
)

describeFast('claude chat on an unreachable local model', () => {
    test('says so with an error frame and spawns nothing', async () => {
        const url = 'http://127.0.0.1:9'
        const cwd = await vaultWith(
            `localModel:\n  enabled: true\n  url: ${url}\n  model: ''\n`,
        )
        const chatId = newChatId()
        chatIds.push(chatId)
        const { sink, frames, waitFor } = makeChatFrameCollector(15_000)

        await sendMessage(chatId, 'hello', cwd, sink)
        const err = await waitFor(f => f.type === 'error')
        expect(err.type === 'error' && err.code).toBe('local-model-unreachable')
        expect(err.type === 'error' && err.message).toBe(
            localUnreachableMessage(url),
        )
        expect(hasSession(chatId)).toBe(false)
        expect(frames.some(f => f.type === 'assistant-text')).toBe(false)
    })
})
