// The provider-connect functions against a hand-written fake opencode client (no binary), plus the
// four /opencode/* routes' owner gate and missing-binary answer.
import { afterEach, describe, expect, test } from 'bun:test'
import type { OpencodeClient } from '@opencode-ai/sdk'
import {
    listProviders,
    oauthAuthorize,
    oauthCallback,
    OpencodeBadRequest,
    setProviderKey,
} from '../../src/chatProviders/opencode/opencodeProviders'
import { createServer } from '../../src/server'
import { makeSampleVault } from '../helpers'

type Fake = {
    all?: { id: string; name: string; env?: string[] }[]
    connected?: string[]
    auth?: Record<string, { type: 'api' | 'oauth'; label: string }[]>
    setResult?: { data?: boolean; error?: unknown }
    setThrows?: unknown
    authorize?: { data?: unknown; error?: unknown }
    callback?: { data?: boolean; error?: unknown }
}

function fakeClient(f: Fake = {}) {
    const calls: { fn: string; arg: unknown }[] = []
    const client = {
        provider: {
            list: async () => ({
                data: {
                    all: f.all ?? [],
                    default: {},
                    connected: f.connected ?? [],
                },
            }),
            auth: async () => ({ data: f.auth ?? {} }),
            oauth: {
                authorize: async (arg: unknown) => {
                    calls.push({ fn: 'authorize', arg })
                    return f.authorize ?? { data: undefined }
                },
                callback: async (arg: unknown) => {
                    calls.push({ fn: 'callback', arg })
                    return f.callback ?? { data: true }
                },
            },
        },
        auth: {
            set: async (arg: unknown) => {
                calls.push({ fn: 'set', arg })
                if (f.setThrows) throw f.setThrows
                return f.setResult ?? { data: true }
            },
        },
    } as unknown as OpencodeClient
    return { client, calls }
}

describe('listProviders', () => {
    const all = [
        { id: 'openai', name: 'OpenAI', env: ['OPENAI_API_KEY'] },
        { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'] },
        { id: 'github-copilot', name: 'GitHub Copilot', env: [] },
        { id: 'zai', name: 'Z.AI', env: [] },
        { id: 'local', name: 'Local model', env: [] },
        { id: 'groq', name: 'Groq', env: ['GROQ_API_KEY'] },
    ]
    const auth = {
        'github-copilot': [
            { type: 'oauth' as const, label: 'Login with GitHub' },
        ],
        anthropic: [
            { type: 'oauth' as const, label: 'Claude Pro/Max' },
            { type: 'api' as const, label: 'API key' },
        ],
    }

    test('splits connected from available, sorted by name', async () => {
        const { client } = fakeClient({
            all,
            auth,
            connected: ['zai', 'github-copilot', 'groq'],
        })
        const res = await listProviders(client, { GROQ_API_KEY: 'x' })
        expect(res.connected.map(p => p.name)).toEqual([
            'GitHub Copilot',
            'Groq',
            'Z.AI',
        ])
        expect(res.available.map(p => p.name)).toEqual(['Anthropic', 'OpenAI'])
    })

    test('connected kind: env var wins, then oauth-only, else api', async () => {
        const { client } = fakeClient({
            all,
            auth,
            connected: ['zai', 'github-copilot', 'groq', 'anthropic'],
        })
        const res = await listProviders(client, { GROQ_API_KEY: 'x' })
        const kind = Object.fromEntries(res.connected.map(p => [p.id, p.kind]))
        expect(kind).toEqual({
            groq: 'env',
            'github-copilot': 'oauth',
            zai: 'api',
            anthropic: 'api',
        })
    })

    test('available methods are never empty: api key when opencode reports none', async () => {
        const { client } = fakeClient({ all, auth })
        const res = await listProviders(client, {})
        const by = Object.fromEntries(res.available.map(p => [p.id, p.methods]))
        expect(by.openai).toEqual([{ type: 'api', label: 'API key' }])
        expect(by.anthropic).toEqual(auth.anthropic)
        expect(by['github-copilot']).toEqual(auth['github-copilot'])
    })

    test('the injected local-model provider is in neither list', async () => {
        const { client } = fakeClient({ all, connected: ['local'] })
        const res = await listProviders(client, {})
        const ids = [...res.connected, ...res.available].map(p => p.id)
        expect(ids).not.toContain('local')
    })
})

describe('setProviderKey', () => {
    const KEY = 'sk-super-secret-1234567890'

    test('sends the key to opencode auth.set as an api credential', async () => {
        const { client, calls } = fakeClient()
        await setProviderKey(client, 'openai', KEY)
        expect(calls).toEqual([
            {
                fn: 'set',
                arg: {
                    path: { id: 'openai' },
                    body: { type: 'api', key: KEY },
                },
            },
        ])
    })

    test('an opencode rejection that echoes the key never carries it out', async () => {
        const { client } = fakeClient({
            setResult: {
                error: { data: { message: `bad key ${KEY} for openai` } },
            },
        })
        const err = await setProviderKey(client, 'openai', KEY).catch(e => e)
        expect(err).toBeInstanceOf(OpencodeBadRequest)
        expect(err.message).toContain('bad key')
        expect(err.message).not.toContain(KEY)
        expect(err.stack).not.toContain(KEY)
    })

    test('a nested { error: { data: { message } } } echo is scrubbed', async () => {
        const { client } = fakeClient({
            setResult: {
                error: { error: { data: { message: `nope ${KEY} nope` } } },
            },
        })
        const err = await setProviderKey(client, 'openai', KEY).catch(e => e)
        expect(err).toBeInstanceOf(OpencodeBadRequest)
        expect(err.message).toContain('nope')
        expect(err.message).not.toContain(KEY)
        expect(err.stack).not.toContain(KEY)
    })

    test('a URL-encoded or JSON-escaped echo of the key is scrubbed', async () => {
        const odd = 'sk-a b/c+d"e\\f'
        for (const echo of [
            encodeURIComponent(odd),
            JSON.stringify(odd).slice(1, -1),
            odd,
        ]) {
            const { client } = fakeClient({
                setResult: {
                    error: { data: { message: `rejected key=${echo}` } },
                },
            })
            const err = await setProviderKey(client, 'openai', odd).catch(
                e => e,
            )
            expect(err).toBeInstanceOf(OpencodeBadRequest)
            expect(err.message).toContain('rejected')
            expect(err.message).not.toContain(echo)
            expect(err.stack).not.toContain(echo)
        }
    })

    test('a whitespace-padded key is trimmed before sending and before scrubbing', async () => {
        const padded = `  ${KEY}\n`
        const ok = fakeClient()
        await setProviderKey(ok.client, 'openai', padded)
        expect(ok.calls[0].arg).toEqual({
            path: { id: 'openai' },
            body: { type: 'api', key: KEY },
        })
        // opencode echoes the key back trimmed — the untrimmed copy would not have matched
        const bad = fakeClient({
            setResult: { error: { data: { message: `bad key ${KEY}` } } },
        })
        const err = await setProviderKey(bad.client, 'openai', padded).catch(
            e => e,
        )
        expect(err).toBeInstanceOf(OpencodeBadRequest)
        expect(err.message).not.toContain(KEY)
        expect(err.stack).not.toContain(KEY)
    })

    test('a thrown transport error that echoes the key is scrubbed too', async () => {
        const { client } = fakeClient({
            setThrows: new Error(`fetch failed: Bearer ${KEY}`),
        })
        const err = await setProviderKey(client, 'openai', KEY).catch(e => e)
        expect(err).toBeInstanceOf(OpencodeBadRequest)
        expect(err.message).not.toContain(KEY)
    })

    test('rejects a bad id or an empty key without calling opencode', async () => {
        const { client, calls } = fakeClient()
        await expect(
            setProviderKey(client, '../x', KEY),
        ).rejects.toBeInstanceOf(OpencodeBadRequest)
        await expect(
            setProviderKey(client, 'openai', '  '),
        ).rejects.toBeInstanceOf(OpencodeBadRequest)
        expect(calls).toEqual([])
    })
})

describe('oauth', () => {
    test('authorize returns url + method + instructions', async () => {
        const { client, calls } = fakeClient({
            authorize: {
                data: {
                    url: 'https://x/auth',
                    method: 'code',
                    instructions: 'paste it',
                },
            },
        })
        expect(await oauthAuthorize(client, 'anthropic', 0)).toEqual({
            url: 'https://x/auth',
            method: 'code',
            instructions: 'paste it',
        })
        expect(calls[0].arg).toEqual({
            path: { id: 'anthropic' },
            body: { method: 0 },
        })
    })

    test('authorize without a url is a bad request', async () => {
        const { client } = fakeClient({ authorize: { data: {} } })
        await expect(
            oauthAuthorize(client, 'anthropic', 0),
        ).rejects.toBeInstanceOf(OpencodeBadRequest)
    })

    test('authorize rejects a non-integer method', async () => {
        const { client } = fakeClient()
        await expect(
            oauthAuthorize(client, 'anthropic', 1.5),
        ).rejects.toBeInstanceOf(OpencodeBadRequest)
    })

    test('callback passes the code only when given, and a false result is a failure', async () => {
        const a = fakeClient()
        await oauthCallback(a.client, 'anthropic', 1, 'abc')
        await oauthCallback(a.client, 'anthropic', 1)
        expect(a.calls.map(c => c.arg)).toEqual([
            { path: { id: 'anthropic' }, body: { method: 1, code: 'abc' } },
            { path: { id: 'anthropic' }, body: { method: 1 } },
        ])
        const b = fakeClient({ callback: { data: false } })
        await expect(
            oauthCallback(b.client, 'anthropic', 1),
        ).rejects.toBeInstanceOf(OpencodeBadRequest)
    })

    test('a callback error that echoes the pasted code is scrubbed', async () => {
        const { client } = fakeClient({
            callback: { error: { message: 'code CODE-777 expired' } },
        })
        const err = await oauthCallback(
            client,
            'anthropic',
            1,
            'CODE-777',
        ).catch(e => e)
        expect(err.message).toContain('expired')
        expect(err.message).not.toContain('CODE-777')
    })
})

describe('routes', () => {
    const TOKEN = 'opencode-routes-test-token'
    const prev = process.env.BISMUTH_OWNER_TOKEN
    afterEach(() => {
        if (prev === undefined) delete process.env.BISMUTH_OWNER_TOKEN
        else process.env.BISMUTH_OWNER_TOKEN = prev
    })

    const routes: [string, string, unknown][] = [
        ['GET', '/opencode/providers', undefined],
        ['POST', '/opencode/auth', { id: 'openai', key: 'sk-x' }],
        ['POST', '/opencode/oauth/authorize', { id: 'anthropic', method: 0 }],
        ['POST', '/opencode/oauth/callback', { id: 'anthropic', method: 0 }],
    ]

    async function withServer(
        run: (
            call: (
                m: string,
                p: string,
                body: unknown,
                owner: boolean,
            ) => Promise<Response>,
        ) => Promise<void>,
        opencodeClient?: () => Promise<OpencodeClient | null>,
    ) {
        process.env.BISMUTH_OWNER_TOKEN = TOKEN
        const { vault, memory } = await makeSampleVault()
        const server = createServer({
            vault,
            memory,
            port: 0,
            opencodeClient: opencodeClient ?? (async () => null),
        })
        try {
            await run((method, path, body, owner) =>
                fetch(`http://localhost:${server.port}${path}`, {
                    method,
                    headers: {
                        'content-type': 'application/json',
                        ...(owner ? { 'X-Bismuth-Token': TOKEN } : {}),
                    },
                    ...(body !== undefined
                        ? { body: JSON.stringify(body) }
                        : {}),
                }),
            )
        } finally {
            server.stop(true)
        }
    }

    test('every route refuses a non-owner with 403 { error: "forbidden" }', async () => {
        await withServer(async call => {
            for (const [m, p, b] of routes) {
                const res = await call(m, p, b, false)
                expect([m, p, res.status]).toEqual([m, p, 403])
                expect(await res.json()).toEqual({ error: 'forbidden' })
            }
        })
    })

    test('every route answers 409 opencode-missing for the owner when there is no opencode client', async () => {
        await withServer(
            async call => {
                for (const [m, p, b] of routes) {
                    const res = await call(m, p, b, true)
                    expect([m, p, res.status]).toEqual([m, p, 409])
                    const body = (await res.json()) as {
                        error: string
                        message: string
                    }
                    expect(body.error).toBe('opencode-missing')
                    expect(body.message).toBeTruthy()
                }
            },
            async () => null,
        )
    })

    test('every route answers 409 opencode-missing when the opencode server fails to start', async () => {
        await withServer(
            async call => {
                for (const [m, p, b] of routes) {
                    const res = await call(m, p, b, true)
                    expect([m, p, res.status]).toEqual([m, p, 409])
                    expect(
                        ((await res.json()) as { error: string }).error,
                    ).toBe('opencode-missing')
                }
            },
            async () => {
                throw new Error('spawn failed')
            },
        )
    })
})
