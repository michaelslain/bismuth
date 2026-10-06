import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKEND_LIST, can } from '../../src/agentBackends/catalog'
import {
    CLOUD_ENV,
    LOCAL_PROVIDER_ID,
    localSpawnFor,
    parseLocalModel,
    withoutCloudEnv,
    type LocalModel,
} from '../../src/agentBackends/localModel'
import {
    listLocalModels,
    localUnreachableMessage,
    readLocalModel,
    resolveLocalSpawn,
} from '../../src/agentBackends/localModelProbe'
import { tempDir } from '../tempDirs'

const LM: LocalModel = { url: 'http://localhost:1234', model: '', apiKey: '' }

describe('parseLocalModel', () => {
    test('off unless enabled with a url', () => {
        expect(parseLocalModel(undefined)).toBeNull()
        expect(parseLocalModel('yes')).toBeNull()
        expect(parseLocalModel({ enabled: false, url: 'http://x' })).toBeNull()
        expect(parseLocalModel({ enabled: true, url: '  ' })).toBeNull()
        expect(parseLocalModel({ enabled: 'true', url: 'http://x' })).toBeNull()
    })

    test('normalizes the url and trims fields', () => {
        expect(
            parseLocalModel({
                enabled: true,
                url: ' http://localhost:11434/v1/ ',
                model: ' gpt-oss:20b ',
                apiKey: ' k ',
            }),
        ).toEqual({
            url: 'http://localhost:11434',
            model: 'gpt-oss:20b',
            apiKey: 'k',
        })
        expect(
            parseLocalModel({ enabled: true, url: 'http://h:1/', model: 3 }),
        ).toEqual({ url: 'http://h:1', model: '', apiKey: '' })
    })
})

describe('withoutCloudEnv', () => {
    test('drops every claude cloud credential and routing var, keeps the rest', () => {
        const env: Record<string, string | undefined> = { PATH: '/bin', HOME: '/h' }
        for (const k of CLOUD_ENV.claude!) env[k] = 'x'
        const out = withoutCloudEnv('claude', env)
        for (const k of CLOUD_ENV.claude!) expect(k in out).toBe(false)
        expect(out.PATH).toBe('/bin')
        expect(out.HOME).toBe('/h')
        expect(env.ANTHROPIC_API_KEY).toBe('x') // the input is not mutated
    })
    test('a backend with no cloud list is passed through unchanged', () => {
        const env = { ANTHROPIC_API_KEY: 'x' }
        expect(withoutCloudEnv('codex', env)).toEqual(env)
    })
})

describe('localSpawnFor', () => {
    test('claude points every model role at the server', () => {
        const s = localSpawnFor('claude', LM, 'qwen3')!
        expect(s.args).toEqual([])
        expect(s.model).toBe('qwen3')
        expect(s.env.ANTHROPIC_BASE_URL).toBe('http://localhost:1234')
        expect(s.env.ANTHROPIC_AUTH_TOKEN).toBe('local')
        for (const k of [
            'ANTHROPIC_MODEL',
            'ANTHROPIC_DEFAULT_MODEL',
            'ANTHROPIC_DEFAULT_OPUS_MODEL',
            'ANTHROPIC_DEFAULT_SONNET_MODEL',
            'ANTHROPIC_DEFAULT_HAIKU_MODEL',
            'ANTHROPIC_DEFAULT_FABLE_MODEL',
            'CLAUDE_CODE_SUBAGENT_MODEL',
        ])
            expect(s.env[k]).toBe('qwen3')
        expect(
            localSpawnFor('claude', { ...LM, apiKey: 'sk' }, 'q')!.env
                .ANTHROPIC_AUTH_TOKEN,
        ).toBe('sk')
    })

    test('codex defines an inline responses provider', () => {
        const s = localSpawnFor('codex', LM, 'qwen3')!
        expect(s.args).toEqual([
            '--config',
            'model_provider="bismuth_local"',
            '--config',
            'model_providers.bismuth_local.name="Local model"',
            '--config',
            'model_providers.bismuth_local.base_url="http://localhost:1234/v1"',
            '--config',
            'model_providers.bismuth_local.wire_api="responses"',
            '--config',
            'model_providers.bismuth_local.env_key="BISMUTH_LOCAL_MODEL_KEY"',
        ])
        expect(s.env).toEqual({ BISMUTH_LOCAL_MODEL_KEY: 'local' })
    })

    test('opencode declares every listed model under the local provider', () => {
        const s = localSpawnFor('opencode', { ...LM, apiKey: 'k' }, 'b', [
            'a',
            'b',
        ])!
        const cfg = JSON.parse(s.env.OPENCODE_CONFIG_CONTENT!)
        expect(cfg.model).toBe(`${LOCAL_PROVIDER_ID}/b`)
        const p = cfg.provider[LOCAL_PROVIDER_ID]
        expect(p.npm).toBe('@ai-sdk/openai-compatible')
        expect(p.options).toEqual({
            baseURL: 'http://localhost:1234/v1',
            apiKey: 'k',
        })
        expect(Object.keys(p.models)).toEqual(['a', 'b'])
        // a model the list lacks is still declared, first
        const c = JSON.parse(
            localSpawnFor('opencode', LM, 'z', ['a'])!.env
                .OPENCODE_CONFIG_CONTENT!,
        )
        expect(Object.keys(c.provider.local.models)).toEqual(['z', 'a'])
        expect(c.provider.local.options.apiKey).toBeUndefined()
    })

    test('goose uses its openai provider via env', () => {
        expect(localSpawnFor('goose', LM, 'qwen3')!.env).toEqual({
            GOOSE_PROVIDER: 'openai',
            GOOSE_MODEL: 'qwen3',
            OPENAI_HOST: 'http://localhost:1234',
            OPENAI_BASE_PATH: 'v1/chat/completions',
            OPENAI_API_KEY: 'local',
        })
    })

    test('a mapping exists exactly where the catalog claims one', () => {
        for (const b of BACKEND_LIST)
            expect(localSpawnFor(b.id, LM, 'm') !== null).toBe(
                can(b.id, 'localModel'),
            )
    })
})

describe('probe', () => {
    let server: ReturnType<typeof Bun.serve>
    let url: string
    let seenAuth: string | null = null
    const dirs: string[] = []

    beforeAll(() => {
        server = Bun.serve({
            port: 0,
            fetch(req) {
                seenAuth = req.headers.get('authorization')
                if (new URL(req.url).pathname === '/v1/models')
                    return Response.json({
                        object: 'list',
                        data: [{ id: 'gemma' }, { id: 'qwen' }, { nope: 1 }],
                    })
                return new Response('no', { status: 404 })
            },
        })
        url = `http://localhost:${server.port}`
    })
    afterAll(async () => {
        server.stop(true)
        for (const d of dirs) await rm(d, { recursive: true, force: true })
    })

    async function vault(settings: string): Promise<string> {
        const d = tempDir('bismuth-localmodel-')
        dirs.push(d)
        await writeFile(join(d, '.settings'), settings)
        return d
    }

    test('listLocalModels reads ids and sends the key', async () => {
        expect(await listLocalModels({ url, model: '', apiKey: 'sk' })).toEqual(
            ['gemma', 'qwen'],
        )
        expect(seenAuth).toBe('Bearer sk')
        expect(
            await listLocalModels({
                url: 'http://127.0.0.1:9',
                model: '',
                apiKey: '',
            }),
        ).toEqual([])
    })

    test('readLocalModel reads the vault section', async () => {
        const v = await vault(
            `localModel:\n  enabled: true\n  url: ${url}/v1\n  model: qwen\n`,
        )
        expect(await readLocalModel(v)).toEqual({
            url,
            model: 'qwen',
            apiKey: '',
        })
        expect(
            await readLocalModel(await vault('chat:\n  provider: claude\n')),
        ).toBeNull()
        expect(
            await readLocalModel(join(tmpdir(), 'no-such-vault-xyz')),
        ).toBeNull()
    })

    test('resolveLocalSpawn picks the model: listed pick > setting > first', async () => {
        const on = await vault(`localModel:\n  enabled: true\n  url: ${url}\n`)
        const first = await resolveLocalSpawn('claude', on)
        expect(first.kind === 'ready' && first.local.model).toBe('gemma')
        expect(first.kind === 'ready' && first.local.models).toEqual([
            'gemma',
            'qwen',
        ])
        const picked = await resolveLocalSpawn('claude', on, 'qwen')
        expect(picked.kind === 'ready' && picked.local.model).toBe('qwen')
        const prefixed = await resolveLocalSpawn('opencode', on, 'local/qwen')
        expect(prefixed.kind === 'ready' && prefixed.local.model).toBe('qwen')
        // a cloud model remembered from before is ignored
        const stale = await resolveLocalSpawn('claude', on, 'opus')
        expect(stale.kind === 'ready' && stale.local.model).toBe('gemma')
        const set = await vault(
            `localModel:\n  enabled: true\n  url: ${url}\n  model: custom\n`,
        )
        const fromSetting = await resolveLocalSpawn('codex', set)
        expect(fromSetting.kind === 'ready' && fromSetting.local.model).toBe(
            'custom',
        )
    })

    test('resolveLocalSpawn is off for unsupported backends and disabled settings', async () => {
        const on = await vault(`localModel:\n  enabled: true\n  url: ${url}\n`)
        expect((await resolveLocalSpawn('cline', on)).kind).toBe('off')
        const off = await vault(
            `localModel:\n  enabled: false\n  url: ${url}\n`,
        )
        expect((await resolveLocalSpawn('claude', off)).kind).toBe('off')
    })

    test('a down server is unreachable, never a silent fallback', async () => {
        const down = await vault(
            'localModel:\n  enabled: true\n  url: http://127.0.0.1:9\n  model: qwen\n',
        )
        expect(await resolveLocalSpawn('claude', down)).toEqual({
            kind: 'unreachable',
            url: 'http://127.0.0.1:9',
        })
        expect(localUnreachableMessage('http://127.0.0.1:9')).toContain(
            'http://127.0.0.1:9',
        )
    })
})
