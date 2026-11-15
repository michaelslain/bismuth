// bench/backendBench/targets.ts
// The rows of the matrix: every chat backend in the catalog times the model sources it supports.
// A binary is resolved through the production resolver (core/src/claudeWhich.ts's `whichBinary`),
// the one the drivers themselves use, so a backend the app finds is one the bench finds.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    BACKEND_IDS,
    BACKENDS,
    isBackendId,
    type BackendId,
} from '../../core/src/agentBackends/catalog'
import { probeLocalServer } from '../../core/src/agentBackends/contextWindowProbe'
import { whichBinary } from '../../core/src/claudeWhich'
import { backendMockEnv } from '../../core/test/support/backendEnv'
import type { ModelServer } from './mock'
import type { BenchTarget, ModelSource } from './types'

const LOCAL_URLS = {
    lmstudio: 'http://localhost:1234',
    ollama: 'http://localhost:11434',
} as const

/** `<backend>@<source>`: `cloud[:model]`, `mock`, `lmstudio:<model>`, `ollama:<model>`. */
export function targetLabel(backend: BackendId, source: ModelSource): string {
    switch (source.kind) {
        case 'cloud':
            return `${backend}@cloud${source.model ? `:${source.model}` : ''}`
        case 'mock':
            return `${backend}@mock`
        case 'local':
            return `${backend}@${source.server}:${source.model}`
    }
}

export function parseTargetLabel(label: string): {
    backend: BackendId
    source: ModelSource
} {
    const at = label.indexOf('@')
    const backend = at < 0 ? label : label.slice(0, at)
    if (at < 0 || !isBackendId(backend))
        throw new Error(
            `Bad target "${label}": expected <backend>@<source>, with a backend from ${BACKEND_IDS.join(', ')}. Example: opencode@mock`,
        )
    const rest = label.slice(at + 1)
    const colon = rest.indexOf(':')
    const kind = colon < 0 ? rest : rest.slice(0, colon)
    const model = colon < 0 ? '' : rest.slice(colon + 1)
    if (kind === 'mock' && !model) return { backend, source: { kind: 'mock' } }
    if (kind === 'cloud')
        return {
            backend,
            source: model ? { kind: 'cloud', model } : { kind: 'cloud' },
        }
    if ((kind === 'lmstudio' || kind === 'ollama') && model)
        return {
            backend,
            source: { kind: 'local', server: kind, url: LOCAL_URLS[kind], model },
        }
    throw new Error(
        `Bad target "${label}": the source must be cloud, cloud:<model>, mock, lmstudio:<model> or ollama:<model>. Example: goose@ollama:qwen3:14b`,
    )
}

/** Test seam: the binary resolver (the production one). */
export const resolver = { which: whichBinary }

function makeTarget(backend: BackendId, source: ModelSource): BenchTarget {
    const d = BACKENDS[backend]
    return {
        label: targetLabel(backend, source),
        backend,
        source,
        binary: resolver.which(d.binary),
        caps: d.capabilities,
    }
}

/** The target a label names, with its binary resolved. */
export function targetFromLabel(label: string): BenchTarget {
    const { backend, source } = parseTargetLabel(label)
    return makeTarget(backend, source)
}

/** The models a local server lists (embedding models dropped), each with its loaded window.
 *  Read-only: nothing is loaded, unloaded or pulled. [] when the server is not running. */
async function localModels(
    server: 'lmstudio' | 'ollama',
): Promise<{ id: string; window: number | null }[]> {
    const probe = await probeLocalServer(LOCAL_URLS[server])
    return (probe?.models ?? []).filter(m => !m.embedding)
}

export async function discoverTargets(opts: {
    sources: ('cloud' | 'mock' | 'local')[]
    backends?: BackendId[]
}): Promise<BenchTarget[]> {
    const backends = (opts.backends ?? [...BACKEND_IDS]).filter(
        id => BACKENDS[id].capabilities.chat,
    )
    const local = opts.sources.includes('local')
        ? {
              lmstudio: await localModels('lmstudio'),
              ollama: await localModels('ollama'),
          }
        : null
    const out: BenchTarget[] = []
    for (const backend of backends) {
        if (opts.sources.includes('cloud'))
            out.push(makeTarget(backend, { kind: 'cloud' }))
        if (opts.sources.includes('mock'))
            out.push(makeTarget(backend, { kind: 'mock' }))
        if (local && BACKENDS[backend].capabilities.localModel) {
            for (const server of ['lmstudio', 'ollama'] as const)
                for (const m of local[server])
                    out.push(
                        makeTarget(backend, {
                            kind: 'local',
                            server,
                            url: LOCAL_URLS[server],
                            model: m.id,
                            ...(m.window ? { window: m.window } : {}),
                        }),
                    )
        }
    }
    return out
}

/** The ACP adapters wrap an agent that has its own mock mapping; they take that one. */
const MOCK_ENV_ALIAS: Partial<Record<BackendId, BackendId>> = {
    'claude-code-acp': 'claude',
    'codex-acp': 'codex',
}

/** The env var each CLI reads for its own state dir, pointed under the clean home. */
const cleanStateDirs = (home: string) => ({
    GEMINI_CLI_HOME: home,
    OPENCLAW_STATE_DIR: join(home, '.openclaw'),
    HERMES_HOME: join(home, '.hermes'),
    CLINE_DIR: join(home, '.cline'),
    CODEX_HOME: join(home, '.codex'),
})

/** A free TCP port, found synchronously (openclaw's mock config needs one up front). The port is
 *  released before the gateway binds it, so another process can take it in between: see
 *  `moveOpenclawGateway`. */
export function freePort(): number {
    const srv = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = srv.port
    srv.stop(true)
    return port
}

/** The port the openclaw mock config puts the gateway on (`gateway.port` in the file
 *  `OPENCLAW_CONFIG_PATH` names), or null when `env` carries no such config. */
export function openclawGatewayPort(env: Record<string, string | undefined>): number | null {
    const path = env.OPENCLAW_CONFIG_PATH
    if (!path) return null
    const m = /gateway[\s\S]*?["']?port["']?\s*:\s*(\d+)/.exec(readFileSync(path, 'utf8'))
    return m ? Number(m[1]) : null
}

/** Start the openclaw gateway on the config's port; when that port was taken between `freePort()`
 *  and the bind (the gateway exits with EADDRINUSE), move the config to a fresh port and start again,
 *  up to `tries` times. Any other failure, or the last EADDRINUSE, is thrown as is. */
export async function startOpenclawGatewayRetrying<T>(
    env: Record<string, string | undefined>,
    start: (env: Record<string, string | undefined>, port: number) => Promise<T>,
    pickPort: () => number = freePort,
    tries = 3,
): Promise<T> {
    for (let attempt = 1; ; attempt++) {
        const port = openclawGatewayPort(env)
        if (!port) throw new Error('openclaw@mock config names no gateway.port')
        try {
            return await start(env, port)
        } catch (err) {
            if (attempt >= tries || !/EADDRINUSE/.test(String(err))) throw err
            moveOpenclawGateway(env, pickPort())
        }
    }
}

/** Rewrite `gateway.port` in the openclaw mock config to `port` (the gateway and the ACP bridge
 *  both read that file, so they move together). Returns false when `env` carries no such config. */
export function moveOpenclawGateway(
    env: Record<string, string | undefined>,
    port: number,
): boolean {
    const path = env.OPENCLAW_CONFIG_PATH
    if (!path) return false
    const text = readFileSync(path, 'utf8')
    const next = text.replace(
        /(gateway[\s\S]*?["']?port["']?\s*:\s*)(\d+)/,
        (_, head: string) => `${head}${port}`,
    )
    if (next === text && openclawGatewayPort(env) !== port) return false
    writeFileSync(path, next)
    return true
}

/**
 * The env a target's backend process runs with, on top of the parent env.
 * - mock: the backend's own mock mapping, pointing at `server` and nothing else. A backend with no
 *   mapping throws rather than run against its real provider.
 * `scenario.vaultRoot` is the scenario vault (cline's Bismuth MCP server runs `bismuth` there).
 * The window is not set here: `ctx.setWindow` runs after the env is built, so cline's window comes
 * from the product reading the mock's `/api/v0/models`, never from this env.
 * - local: empty: the vault's `localModel` setting (see `seedVault`) points the drivers at the
 *   server, through the production path.
 * - cloud: empty: the backend's own login.
 * `home: 'real'` keeps the user's HOME and CLI configs; `'clean'` adds a throwaway HOME and XDG dirs
 * under `workDir`.
 */
export function targetEnv(
    target: BenchTarget,
    server: ModelServer | null,
    workDir: string,
    home: 'real' | 'clean',
    scenario: { vaultRoot?: string } = {},
): Record<string, string> {
    const env: Record<string, string> = {}
    if (home === 'clean') {
        const dirs = {
            HOME: join(workDir, 'home'),
            XDG_CONFIG_HOME: join(workDir, 'xdg', 'config'),
            XDG_DATA_HOME: join(workDir, 'xdg', 'data'),
            XDG_CACHE_HOME: join(workDir, 'xdg', 'cache'),
            XDG_STATE_HOME: join(workDir, 'xdg', 'state'),
            // each CLI's own state dir, so one that ignores HOME still stays in the throwaway home
            ...cleanStateDirs(join(workDir, 'home')),
        }
        for (const [k, dir] of Object.entries(dirs)) {
            mkdirSync(dir, { recursive: true })
            env[k] = dir
        }
    }
    if (target.source.kind !== 'mock') return env
    if (!server)
        throw new Error(
            `${target.label} needs a model server: start one with startModelServer and pass it to targetEnv`,
        )
    const mapped = MOCK_ENV_ALIAS[target.backend] ?? target.backend
    const mockDir = join(workDir, 'mock-config')
    mkdirSync(mockDir, { recursive: true })
    try {
        Object.assign(
            env,
            backendMockEnv(
                mapped,
                server.url,
                mockDir,
                mapped === 'openclaw' ? freePort() : undefined,
                scenario,
            ),
        )
    } catch (err) {
        if (String(err).includes('no mock-env mapping'))
            throw new Error(
                `${target.backend} has no way to point at the mock model server yet (core/test/support/backendEnv.ts has no row for it), so ${target.label} cannot run without reaching its real provider`,
            )
        throw err
    }
    // opencode's mock provider lists one model; `models` needs a second to switch to
    if (target.backend === 'opencode' && env.OPENCODE_CONFIG_CONTENT) {
        const cfg = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
        cfg.provider.mock.models['mock-2'] = { name: 'Mock 2' }
        env.OPENCODE_CONFIG_CONTENT = JSON.stringify(cfg)
    }
    return env
}
