import { describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
    readOpencodeServers,
    resolveOpencodeServers,
} from '../../src/chatProviders/opencode/opencodeLocalServers'
import { tempDir } from '../tempDirs'
import {
    COMPACT_AGENT_SYSTEM,
    COMPACT_PERMISSIONS,
    THINKING_VARIANTS,
    buildOpencodeConfig,
    opencodeConfigContent,
    opencodeServerId,
    parseOpencodeServers,
    windowLimit,
    type OpencodeConfigInput,
} from '../../src/chatProviders/opencode/opencodeConfig'

const LM = { url: 'http://localhost:1234', model: '', apiKey: '' }
const NONE: OpencodeConfigInput = {
    local: null,
    servers: [],
    limits: [],
    profile: 'default',
}

describe('windowLimit', () => {
    test('keeps the known output, capped at the window; unknown output is the window', () => {
        expect(windowLimit(8192, 8192)).toEqual({ context: 8192, output: 8192 })
        expect(windowLimit(8192, 32000)).toEqual({ context: 8192, output: 8192 })
        expect(windowLimit(65536, 8192)).toEqual({ context: 65536, output: 8192 })
        expect(windowLimit(8192, null)).toEqual({ context: 8192, output: 8192 })
    })
})

describe('buildOpencodeConfig', () => {
    test('null when there is nothing to inject', () => {
        expect(buildOpencodeConfig(NONE)).toBeNull()
        expect(opencodeConfigContent(NONE)).toBeNull()
    })
    test('local only: today content plus variants and limit', () => {
        const cfg = buildOpencodeConfig({
            ...NONE,
            local: {
                lm: { ...LM, apiKey: 'k' },
                model: 'b',
                models: ['a', 'b'],
                windows: { b: 8192 },
            },
        })!
        expect(cfg.model).toBe('local/b')
        expect(cfg.permissions).toBeUndefined()
        expect(cfg).toEqual({
            model: 'local/b',
            provider: {
                local: {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'Local model',
                    options: { baseURL: 'http://localhost:1234/v1', apiKey: 'k' },
                    models: {
                        a: { name: 'a', variants: THINKING_VARIANTS },
                        b: {
                            name: 'b',
                            variants: THINKING_VARIANTS,
                            limit: { context: 8192, output: 8192 },
                        },
                    },
                },
            },
        })
        expect(JSON.parse(opencodeConfigContent({ ...NONE, local: { lm: LM, model: 'a', models: ['a'], windows: {} } })!).provider.local.options).toEqual({
            baseURL: 'http://localhost:1234/v1',
        })
    })
    test('servers become providers of their own', () => {
        const cfg = buildOpencodeConfig({
            ...NONE,
            servers: [
                {
                    id: 'local-lm-studio',
                    name: 'LM Studio',
                    url: 'http://192.168.1.20:1234',
                    apiKey: '',
                    models: [
                        { id: 'x', window: 4096 },
                        { id: 'y', window: null },
                    ],
                },
            ],
        })!
        expect(cfg).toEqual({
            provider: {
                'local-lm-studio': {
                    npm: '@ai-sdk/openai-compatible',
                    name: 'LM Studio',
                    options: { baseURL: 'http://192.168.1.20:1234/v1' },
                    models: {
                        x: {
                            name: 'x',
                            variants: THINKING_VARIANTS,
                            limit: { context: 4096, output: 4096 },
                        },
                        y: { name: 'y', variants: THINKING_VARIANTS },
                    },
                },
            },
        })
    })
    test('limits are limit-only blocks (the merge is deep) and merge into an injected provider', () => {
        const cfg = buildOpencodeConfig({
            ...NONE,
            limits: [
                {
                    providerID: 'lmstudio',
                    modelID: 'qwen/qwen3.5-9b',
                    context: 8192,
                    output: 8192,
                    baseURL: 'http://127.0.0.1:1234/v1',
                },
            ],
        })!
        expect(cfg).toEqual({
            provider: {
                lmstudio: {
                    models: {
                        'qwen/qwen3.5-9b': { limit: { context: 8192, output: 8192 } },
                    },
                },
            },
        })
        const both = buildOpencodeConfig({
            ...NONE,
            local: { lm: LM, model: 'a', models: ['a'], windows: {} },
            limits: [
                { providerID: 'local', modelID: 'a', context: 1, output: 1, baseURL: '' },
            ],
        })!
        const a = (both.provider as any).local.models.a
        expect(a.name).toBe('a')
        expect(a.limit).toEqual({ context: 1, output: 1 })
    })
    test('compact adds exactly the eight denies and both agent systems', () => {
        const cfg = buildOpencodeConfig({ ...NONE, profile: 'compact' })!
        expect(cfg.provider).toBeUndefined()
        expect(cfg.permissions).toEqual(COMPACT_PERMISSIONS)
        expect((cfg.permissions as any[]).map(p => p.action)).toEqual([
            'skill',
            'execute',
            'opencode_*',
            'question',
            'websearch',
            'webfetch',
            'subagent',
            'task',
        ])
        expect(
            (cfg.permissions as any[]).every(
                p => p.resource === '*' && p.effect === 'deny',
            ),
        ).toBe(true)
        expect(cfg.agents).toEqual({
            build: { system: COMPACT_AGENT_SYSTEM },
            plan: { system: COMPACT_AGENT_SYSTEM },
        })
        expect(COMPACT_AGENT_SYSTEM).toBe(
            "You are a notes assistant working in the user's vault. Use the tools to read, search and edit files. Be brief.",
        )
    })
})

describe('opencodeServerId', () => {
    test('slug, collisions', () => {
        expect(opencodeServerId('LM Studio', [])).toBe('local-lm-studio')
        expect(opencodeServerId('LM Studio', ['local-lm-studio'])).toBe(
            'local-lm-studio-2',
        )
        expect(
            opencodeServerId('LM Studio', ['local-lm-studio', 'local-lm-studio-2']),
        ).toBe('local-lm-studio-3')
        expect(opencodeServerId('  !!  ', [])).toBe('local-server')
        expect(opencodeServerId('Ünï Cödé 7', [])).toMatch(/^local-[a-z0-9-]+$/)
    })
})

describe('parseOpencodeServers', () => {
    test('garbage never throws and is dropped', () => {
        for (const g of [undefined, null, 3, 'x', {}, [null, 1, 'a', [], { url: 3 }, { url: 'nope' }]])
            expect(parseOpencodeServers(g)).toEqual([])
    })
    test('valid entries are normalized, ids minted and unique', () => {
        expect(
            parseOpencodeServers([
                { id: 'local-a', name: ' A ', url: 'http://h:1/v1/', apiKey: ' k ' },
                { name: 'A', url: 'http://h:2' },
                { id: 'local-a', name: 'B', url: 'http://h:3' },
                { id: 'BAD ID', url: 'http://h:4' },
            ]),
        ).toEqual([
            { id: 'local-a', name: 'A', url: 'http://h:1', apiKey: 'k' },
            { id: 'local-a-2', name: 'A', url: 'http://h:2', apiKey: '' },
            { id: 'local-b', name: 'B', url: 'http://h:3', apiKey: '' },
            { id: 'local-http-h-4', name: 'http://h:4', url: 'http://h:4', apiKey: '' },
        ])
    })
})

describe('saved servers from .settings', () => {
    test('read, probed, embeddings dropped, silent servers left out', async () => {
        const srv = Bun.serve({
            port: 0,
            fetch(req) {
                return new URL(req.url).pathname === '/v1/models'
                    ? Response.json({
                          data: [{ id: 'chat-model' }, { id: 'text-embedding-x' }],
                      })
                    : new Response('no', { status: 404 })
            },
        })
        const dir = tempDir('bismuth-oc-servers-')
        try {
            await writeFile(
                join(dir, '.settings'),
                `chat:\n  opencodeServers:\n    - name: Up\n      url: http://localhost:${srv.port}\n    - name: Down\n      url: http://127.0.0.1:9\n`,
            )
            expect((await readOpencodeServers(dir)).map(s => s.id)).toEqual([
                'local-up',
                'local-down',
            ])
            const resolved = await resolveOpencodeServers(dir)
            expect(resolved.map(s => s.id)).toEqual(['local-up'])
            expect(resolved[0].models).toEqual([{ id: 'chat-model', window: null }])
            expect(await readOpencodeServers(join(dir, 'missing'))).toEqual([])
        } finally {
            srv.stop(true)
            await rm(dir, { recursive: true, force: true })
        }
    })
})
