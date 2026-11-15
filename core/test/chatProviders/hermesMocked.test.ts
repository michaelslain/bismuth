// A hermes mock row (core/test/support/backendEnv.ts) writes a throwaway HERMES_HOME and drives one
// reply through CHAT_BACKENDS.hermes against the mock LLM. The row's file is checked always; the
// turn runs only where the real `hermes` binary is installed.
import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { whichBinary } from '../../src/claudeWhich'
import { CHAT_BACKENDS } from '../../src/chatProviders/backends'
import { backendMockEnv } from '../support/backendEnv'
import { makeChatFrameCollector } from '../support/chatFrameCollector'
import { startMockLlm, type MockLlmHandle } from '../support/mockLlm'
import { shouldRunSlowTests } from '../slowGate'
import { tempDir } from '../tempDirs'

describe('hermes mock row', () => {
    test('writes config.yaml under a throwaway HERMES_HOME and points the env at the mock', () => {
        const dir = tempDir('bismuth-hermes-row-')
        const env = backendMockEnv('hermes', 'http://127.0.0.1:9', dir)
        expect(env.HERMES_HOME).toBe(join(dir, 'hermes'))
        expect(env.OPENAI_BASE_URL).toBe('http://127.0.0.1:9/v1')
        expect(env.OPENAI_API_KEY).toBe('mock')
        const yaml = readFileSync(join(env.HERMES_HOME, 'config.yaml'), 'utf8')
        expect(yaml).toContain('provider: custom')
        expect(yaml).toContain('base_url: http://127.0.0.1:9/v1')
        expect(yaml).toContain('default: mock-model')
        expect(existsSync(join(dir, 'hermes'))).toBe(true)
    })
    test('needs a workDir', () => {
        expect(() => backendMockEnv('hermes', 'http://x')).toThrow('workDir')
    })
})

const HAS_HERMES = whichBinary('hermes') !== null
const describeOrSkip =
    HAS_HERMES && shouldRunSlowTests(process.env) ? describe : describe.skip

describeOrSkip('the real hermes, through the ACP driver, against a mock LLM', () => {
    const KEYS = ['HERMES_HOME', 'OPENAI_BASE_URL', 'OPENAI_API_KEY'] as const
    const saved: Record<string, string | undefined> = {}
    for (const k of KEYS) saved[k] = process.env[k]
    let mock: MockLlmHandle | undefined
    afterAll(async () => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
        await mock?.stop()
    })

    test('one reply returns the fixture text, then result + done', async () => {
        mock = await startMockLlm()
        const env = backendMockEnv('hermes', mock.url, tempDir('bismuth-hermes-'))
        for (const [k, v] of Object.entries(env)) process.env[k] = v
        const chatId = 'hermes-mocked-' + Date.now()
        const { sink, frames, waitFor } = makeChatFrameCollector()
        CHAT_BACKENDS.hermes.sendMessage({
            chatId,
            cwd: tempDir('bismuth-hermes-cwd-'),
            sink,
            text: 'hello',
        })
        try {
            const text = await waitFor(f => f.type === 'assistant-text')
            if (text.type === 'assistant-text') expect(text.text).toBe('Hello!')
            await waitFor(f => f.type === 'done')
            const r = frames.find(f => f.type === 'result')
            if (r?.type === 'result') expect(r.isError).toBe(false)
        } finally {
            CHAT_BACKENDS.hermes.closeChat(chatId)
        }
    }, 90_000)
})
