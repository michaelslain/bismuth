import { describe, expect, test } from 'bun:test'
import {
    contextOverflowMessage,
    isContextOverflow,
} from '../../src/chatProviders/opencode/opencodeOverflow'

// The exact string in .claude/bust/opencode-chat/run1.ndjson.
const LMSTUDIO =
    'The number of tokens to keep from the initial prompt is greater than the context length. Try to load the model with a larger context length, or provide a shorter input'

describe('isContextOverflow', () => {
    test('true for each server phrasing', () => {
        for (const m of [
            LMSTUDIO,
            'the request exceeds the available context size (8192 tokens), try increasing it',
            "This model's maximum context length is 4096 tokens. However, you requested 9000",
            '{"error":{"code":"context_length_exceeded"}}',
            'Input exceeds the context window of this model',
            'The context length was exceeded',
            'prompt too long for the context window',
        ])
            expect(isContextOverflow(m)).toBe(true)
    })
    test('false for an unrelated error that mentions context', () => {
        for (const m of [
            'Provider request failed with HTTP 500',
            'Invalid request: missing context field',
            'rate limit reached, retry later',
            'ECONNREFUSED 127.0.0.1:1234',
            '',
        ])
            expect(isContextOverflow(m)).toBe(false)
    })
})

describe('contextOverflowMessage', () => {
    test('known window, per server hint', () => {
        const base = { model: 'Qwen3.5 9B (local)', window: 8192 }
        expect(contextOverflowMessage({ ...base, kind: 'lmstudio' })).toBe(
            "Qwen3.5 9B (local) is loaded with an 8,192-token context window, too small for an agent prompt. Load it with a larger context length (LM Studio: the model's load settings) and try again.",
        )
        expect(contextOverflowMessage({ ...base, kind: 'ollama' })).toBe(
            'Qwen3.5 9B (local) is loaded with an 8,192-token context window, too small for an agent prompt. Load it with a larger context length (Ollama: the num_ctx parameter) and try again.',
        )
        expect(contextOverflowMessage({ ...base, kind: 'vllm' })).toBe(
            'Qwen3.5 9B (local) is loaded with an 8,192-token context window, too small for an agent prompt. Load it with a larger context length and try again.',
        )
        expect(contextOverflowMessage({ ...base, kind: null })).toBe(
            contextOverflowMessage({ ...base, kind: 'openai' }),
        )
    })
    test('unknown window', () => {
        expect(
            contextOverflowMessage({ model: 'm', window: null, kind: null }),
        ).toBe(
            'm ran out of context before the prompt fit, even with the compact prompt. Load it with a larger context length and try again.',
        )
        expect(
            contextOverflowMessage({ model: 'm', window: null, kind: 'ollama' }),
        ).toContain('(Ollama: the num_ctx parameter) and try again.')
    })
    test('the article follows how the number is read', () => {
        const t = (window: number) =>
            contextOverflowMessage({ model: 'm', window, kind: null })
        expect(t(4096)).toContain('with a 4,096-token')
        expect(t(16384)).toContain('with a 16,384-token')
        expect(t(18000)).toContain('with an 18,000-token')
        expect(t(131072)).toContain('with a 131,072-token')
        expect(t(110000)).toContain('with a 110,000-token')
        expect(t(8192)).toContain('with an 8,192-token')
    })
})
