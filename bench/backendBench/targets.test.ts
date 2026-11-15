import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKEND_LIST } from '../../core/src/agentBackends/catalog'
import { startModelServer, type ModelServer } from './mock'
import {
    discoverTargets,
    openclawGatewayPort,
    parseTargetLabel,
    resolver,
    startOpenclawGatewayRetrying,
    targetEnv,
    targetFromLabel,
    targetLabel,
} from './targets'
import type { BenchTarget } from './types'

const chatBackends = BACKEND_LIST.filter(d => d.capabilities.chat)
const dirs: string[] = []
const workDir = () => {
    const d = mkdtempSync(join(tmpdir(), 'bismuth-bench-targets-'))
    dirs.push(d)
    return d
}
afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('targets', () => {
    test('every chat backend yields a @mock target', async () => {
        const targets = await discoverTargets({ sources: ['mock'] })
        expect(targets.map(t => t.label).sort()).toEqual(
            chatBackends.map(d => `${d.id}@mock`).sort(),
        )
        for (const t of targets) expect(t.caps).toBe(chatBackends.find(d => d.id === t.backend)!.capabilities)
    })

    test('parseTargetLabel round-trips the example labels', () => {
        for (const label of [
            'claude@cloud',
            'opencode@mock',
            'opencode@lmstudio:qwen/qwen3.5-9b',
            'goose@ollama:qwen3:14b',
        ]) {
            const { backend, source } = parseTargetLabel(label)
            expect(targetLabel(backend, source)).toBe(label)
        }
        expect(parseTargetLabel('goose@ollama:qwen3:14b').source).toMatchObject({
            kind: 'local',
            server: 'ollama',
            model: 'qwen3:14b',
        })
        expect(() => parseTargetLabel('nope@mock')).toThrow('Example')
        expect(() => parseTargetLabel('opencode')).toThrow('Example')
        expect(() => parseTargetLabel('opencode@lmstudio')).toThrow('Example')
    })

    test('a backend whose binary does not resolve gets binary: null', async () => {
        const real = resolver.which
        const asked: string[] = []
        resolver.which = name => {
            asked.push(name)
            return name === 'opencode' ? null : `/fake/${name}`
        }
        try {
            const targets = await discoverTargets({ sources: ['mock'] })
            expect(targets.find(t => t.backend === 'opencode')!.binary).toBeNull()
            expect(targets.find(t => t.backend === 'claude')!.binary).toBe('/fake/claude')
            expect(asked).toContain('opencode')
        } finally {
            resolver.which = real
        }
    })

    describe('targetEnv under mock', () => {
        let server: ModelServer
        afterAll(() => server?.stop())
        for (const d of chatBackends) {
            test(`${d.id} points only at the model server`, async () => {
                server ??= await startModelServer({ fixtures: [] })
                const target: BenchTarget = {
                    label: `${d.id}@mock`,
                    backend: d.id,
                    source: { kind: 'mock' },
                    binary: null,
                    caps: d.capabilities,
                }
                const wd = workDir()
                let env: Record<string, string>
                try {
                    env = targetEnv(target, server, wd, 'real')
                } catch (err) {
                    // a backend with no mock mapping must refuse, never run against its provider
                    expect(String(err)).toContain('no way to point at the mock')
                    return
                }
                const texts = Object.values(env)
                if (existsSync(join(wd, 'mock-config')))
                    for (const f of walk(join(wd, 'mock-config')))
                        texts.push(readFileSync(f, 'utf8'))
                const hosts = texts
                    .join('\n')
                    .replace(/"\$schema":\s*"[^"]*"/g, '')
                    .match(/https?:\/\/[^\s"'\\]+/g)
                for (const u of hosts ?? [])
                    expect(u.startsWith(server.url)).toBe(true)
                expect(Object.keys(env)).not.toContain('HOME')
            })
        }

        test("'clean' adds a throwaway home", () => {
            const t = targetFromLabel('opencode@mock')
            const wd = workDir()
            const env = targetEnv(t, server, wd, 'clean')
            expect(env.HOME.startsWith(wd)).toBe(true)
            expect(env.XDG_CONFIG_HOME.startsWith(wd)).toBe(true)
        })

        test("'clean' points every CLI's own state dir and XDG under the workdir", () => {
            const wd = workDir()
            const env = targetEnv(targetFromLabel('opencode@mock'), server, wd, 'clean')
            for (const k of [
                'HOME',
                'GEMINI_CLI_HOME',
                'OPENCLAW_STATE_DIR',
                'HERMES_HOME',
                'CLINE_DIR',
                'CODEX_HOME',
                'XDG_CONFIG_HOME',
                'XDG_DATA_HOME',
                'XDG_CACHE_HOME',
                'XDG_STATE_HOME',
            ])
                expect(env[k]?.startsWith(wd)).toBe(true)
        })

        test("'real' sets no home or state dir for a cloud target", () => {
            const env = targetEnv(targetFromLabel('gemini@cloud'), null, workDir(), 'real')
            expect(env).toEqual({})
        })

        test('opencode@mock lists two models so a switch has somewhere to go', () => {
            const env = targetEnv(targetFromLabel('opencode@mock'), server, workDir(), 'real')
            const models = JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider.mock.models
            expect(Object.keys(models)).toEqual(['mock', 'mock-2'])
        })

        test('a mock target without a server is an error that names the fix', () => {
            expect(() =>
                targetEnv(targetFromLabel('claude@mock'), null, workDir(), 'real'),
            ).toThrow('startModelServer')
        })
    })
})

function walk(dir: string): string[] {
    return readdirSync(dir).flatMap(n => {
        const p = join(dir, n)
        return statSync(p).isDirectory() ? walk(p) : [p]
    })
}

describe('openclawGatewayPort', () => {
    test('reads back the port targetEnv wrote into the openclaw config', async () => {
        const server = await startModelServer({ fixtures: [] })
        try {
            const env = targetEnv(targetFromLabel('openclaw@mock'), server, workDir(), 'real')
            const port = openclawGatewayPort(env)
            expect(port).toBeGreaterThan(0)
            expect(readFileSync(env.OPENCLAW_CONFIG_PATH!, 'utf8')).toMatch(new RegExp(`"port": ${port}`))
        } finally {
            await server.stop()
        }
    })
    test('null when the env has no openclaw config', () => {
        expect(openclawGatewayPort({})).toBeNull()
    })
})

describe('startOpenclawGatewayRetrying', () => {
    const withConfig = async (fn: (env: Record<string, string | undefined>) => Promise<void>) => {
        const server = await startModelServer({ fixtures: [] })
        try {
            await fn(targetEnv(targetFromLabel('openclaw@mock'), server, workDir(), 'real'))
        } finally {
            await server.stop()
        }
    }
    test('a port taken before the bind moves the config to a fresh port and starts again', () =>
        withConfig(async env => {
            const first = openclawGatewayPort(env)!
            const seen: number[] = []
            const got = await startOpenclawGatewayRetrying(
                env,
                async (_env, port) => {
                    seen.push(port)
                    if (seen.length === 1) throw new Error('listen EADDRINUSE: address already in use')
                    return port
                },
                () => first + 1,
            )
            expect(seen).toEqual([first, first + 1])
            expect(got).toBe(first + 1)
            expect(openclawGatewayPort(env)).toBe(first + 1)
        }))
    test('any other failure is thrown at once', () =>
        withConfig(async env => {
            let calls = 0
            await expect(
                startOpenclawGatewayRetrying(env, async () => {
                    calls++
                    throw new Error('gateway did not print ready')
                }),
            ).rejects.toThrow('did not print ready')
            expect(calls).toBe(1)
        }))
    test('gives up after three EADDRINUSE starts', () =>
        withConfig(async env => {
            let calls = 0
            await expect(
                startOpenclawGatewayRetrying(
                    env,
                    async () => {
                        calls++
                        throw new Error('EADDRINUSE')
                    },
                    () => 40000 + calls,
                ),
            ).rejects.toThrow('EADDRINUSE')
            expect(calls).toBe(3)
        }))
})
