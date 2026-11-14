import { describe, expect, test } from 'bun:test'
import {
    mergeOpencodeConfig,
    withInjectedConfig,
} from '../../src/chatProviders/opencode/opencodeConfig'
import { serverSpawnEnv } from '../../src/chatProviders/opencode/opencodeServer'

const INHERITED = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
        mock: {
            npm: '@ai-sdk/openai-compatible',
            options: { baseURL: 'http://127.0.0.1:9999/v1' },
            models: { mock: { name: 'Mock' } },
        },
    },
    model: 'mock/mock',
}

describe('mergeOpencodeConfig', () => {
    test('objects merge key by key; the injected side wins a collision', () => {
        const merged = mergeOpencodeConfig(INHERITED, {
            provider: {
                mock: { models: { mock: { limit: { context: 8, output: 8 } } } },
                lmstudio: { models: { q: { limit: { context: 4, output: 4 } } } },
            },
            model: 'local/q',
        })
        expect(merged).toEqual({
            $schema: 'https://opencode.ai/config.json',
            provider: {
                mock: {
                    npm: '@ai-sdk/openai-compatible',
                    options: { baseURL: 'http://127.0.0.1:9999/v1' },
                    models: {
                        mock: {
                            name: 'Mock',
                            limit: { context: 8, output: 8 },
                        },
                    },
                },
                lmstudio: {
                    models: { q: { limit: { context: 4, output: 4 } } },
                },
            },
            model: 'local/q',
        })
    })

    test('an array is replaced, not concatenated', () => {
        expect(
            mergeOpencodeConfig(
                { permissions: [{ action: 'a' }] },
                { permissions: [{ action: 'b' }] },
            ),
        ).toEqual({ permissions: [{ action: 'b' }] })
    })

    test('leaves both inputs untouched', () => {
        const before = JSON.stringify(INHERITED)
        mergeOpencodeConfig(INHERITED, { provider: { mock: { name: 'x' } } })
        expect(JSON.stringify(INHERITED)).toBe(before)
    })
})

describe('withInjectedConfig', () => {
    const base = {
        PATH: '/bin',
        OPENCODE_CONFIG_CONTENT: JSON.stringify(INHERITED),
    }
    const injected = {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
            provider: {
                lmstudio: { models: { q: { limit: { context: 4, output: 4 } } } },
            },
        }),
    }

    test('an inherited config keeps its provider and model under an injected one', () => {
        const env = withInjectedConfig(base, injected)
        const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT as string)
        expect(cfg.model).toBe('mock/mock')
        expect(cfg.provider.mock.options.baseURL).toBe(
            'http://127.0.0.1:9999/v1',
        )
        expect(cfg.provider.lmstudio.models.q.limit.context).toBe(4)
        expect(env.PATH).toBe('/bin')
    })

    test('no injected config keeps the inherited one as is', () => {
        expect(withInjectedConfig(base, null)).toEqual(base)
        expect(withInjectedConfig(base, {})).toEqual(base)
    })

    test('no inherited config takes the injected one as is', () => {
        expect(withInjectedConfig({ PATH: '/bin' }, injected)).toEqual({
            PATH: '/bin',
            ...injected,
        })
    })

    test('an inherited value that is not a JSON object is replaced', () => {
        const env = withInjectedConfig(
            { OPENCODE_CONFIG_CONTENT: 'not json' },
            injected,
        )
        expect(env.OPENCODE_CONFIG_CONTENT).toBe(
            injected.OPENCODE_CONFIG_CONTENT,
        )
    })

    test('serverSpawnEnv merges the same way', () => {
        const env = serverSpawnEnv(base, { env: injected })
        const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT as string)
        expect(cfg.model).toBe('mock/mock')
        expect(Object.keys(cfg.provider).sort()).toEqual(['lmstudio', 'mock'])
    })
})
