// bench/backendBench/run.ts
// Loads scenarios and runs them against one target. Each scenario gets a fresh seeded vault and (in
// mock and local mode) its own model server; a watchdog turns a hang into a `timeout` cell, and every
// cell is printed as a `CELL <json>` line the moment it lands so a killed run keeps what it measured.
//
// Nothing here imports the harness modules (vault, mock, driver): the caller passes them in `deps`,
// so the runner is tested with fakes and the CLI wires the real ones.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ChatFrame } from '../../core/src/chat'
import type {
    BenchTarget,
    Cell,
    ChatDriver,
    ModelRequest,
    Scenario,
    ScenarioCtx,
    ScenarioOutcome,
    Verdict,
} from './types'

/** The slice of `ModelServer` (./mock.ts) the runner uses. */
export type ModelServerLike = {
    url: string
    requests(): ModelRequest[]
    setWindow(tokens: number | null): void
    stop(): Promise<void>
}

export type RunDeps = {
    seedVault(
        target: BenchTarget,
        opts?: { localModel?: { url: string; model: string } },
    ): string
    startModelServer(
        opts: { fixtures: unknown[] } | { upstream: string },
    ): Promise<ModelServerLike>
    createChatDriver(
        target: BenchTarget,
        vault: string,
        log?: (line: string) => void,
    ): ChatDriver
    resumeChatDriver(
        target: BenchTarget,
        vault: string,
        sessionId: string,
    ): Promise<ChatDriver>
    historyFrames(
        target: BenchTarget,
        vault: string,
        sessionId: string,
    ): Promise<ChatFrame[]>
    /** Runs a `bismuth` command against the vault. */
    bismuth(
        vault: string,
        args: string[],
    ): Promise<{ code: number; stdout: string; stderr: string }>
    /** Env the scenario's chats run under (set on `process.env` for the scenario, then restored). */
    env?(
        target: BenchTarget,
        server: ModelServerLike | null,
        vault: string,
    ): Record<string, string>
    /** A process the target needs beside the chat (openclaw's gateway), started once the env is
     *  set and stopped with the scenario. `env` is the full env the chat runs under. */
    sidecar?(
        target: BenchTarget,
        env: Record<string, string | undefined>,
        vault: string,
    ): Promise<{ stop(): Promise<void> } | null>
    /** Removes a scenario vault. */
    removeVault?(vault: string): void
    /** Drops per-process backend state (a cached `opencode serve`) so the next scenario's env
     *  reaches a fresh server. Called after chats close, before the model server stops. */
    resetBackends?(): void
    /** Where `CELL` lines go; defaults to stdout. */
    print?(line: string): void
}

/** gemini-cli asks a routing model for a JSON complexity score before every turn; a fixture that
 *  answers plain text makes it retry for about 90 s. core/test's basic-turn.json carries the same. */
export const GEMINI_CLASSIFIER_FIXTURE = {
    match: { systemMessage: 'assign a **Complexity Score** from 1 to 100' },
    response: {
        content: {
            complexity_reasoning: 'mock fixture: trivial request',
            complexity_score: 10,
        },
    },
}

/** The fixtures a mock target's model server starts with: the scenario's, behind any prelude the
 *  backend needs on every turn. */
export function fixturesFor(target: BenchTarget, fixtures: unknown[]): unknown[] {
    return target.backend === 'gemini'
        ? [GEMINI_CLASSIFIER_FIXTURE, ...fixtures]
        : fixtures
}

/** The mock is registered as the vault's local model, so a backend's own window detection runs. */
export const MOCK_MODEL = 'mock'

const SCENARIO_DIR = join(import.meta.dir, 'scenarios')

/** Imports every `scenarios/*.ts` (each default-exports `Scenario[]`), in file order, filtered by
 *  suite and id. An id that matches no scenario throws, naming the known ids. */
export async function loadScenarios(
    opts: { suites?: string[]; ids?: string[]; dir?: string } = {},
): Promise<Scenario[]> {
    const dir = opts.dir ?? SCENARIO_DIR
    const files = readdirSync(dir)
        .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .sort()
    const all: Scenario[] = []
    for (const f of files) {
        const mod = await import(join(dir, f))
        if (Array.isArray(mod.default)) all.push(...(mod.default as Scenario[]))
    }
    const seen = new Set<string>()
    for (const s of all) {
        if (seen.has(s.id)) throw new Error(`duplicate scenario id '${s.id}'`)
        seen.add(s.id)
    }
    const bySuite = opts.suites?.length
        ? all.filter(s => opts.suites!.includes(s.suite))
        : all
    if (!opts.ids?.length) return bySuite
    const unknown = opts.ids.filter(id => !all.some(s => s.id === id))
    if (unknown.length) {
        throw new Error(
            `no scenario '${unknown.join("', '")}'; known: ${all.map(s => s.id).join(', ')}`,
        )
    }
    return bySuite.filter(s => opts.ids!.includes(s.id))
}

const within = <T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> =>
    new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve('timeout'), ms)
        p.then(
            v => {
                clearTimeout(t)
                resolve(v)
            },
            e => {
                clearTimeout(t)
                reject(e)
            },
        )
    })

const message = (e: unknown) =>
    e instanceof Error ? e.message : String(e)

export async function runTarget(
    target: BenchTarget,
    scenarios: Scenario[],
    deps: RunDeps,
): Promise<Cell[]> {
    const print = deps.print ?? (line => console.log(line))
    const cells: Cell[] = []
    for (const scenario of scenarios) {
        const cell = await runOne(target, scenario, deps)
        cells.push(cell)
        print(`CELL ${JSON.stringify(cell)}`)
    }
    return cells
}

async function runOne(
    target: BenchTarget,
    scenario: Scenario,
    deps: RunDeps,
): Promise<Cell> {
    const log: string[] = []
    const started = Date.now()
    const done = (
        verdict: Verdict,
        detail: string,
        metrics: Record<string, number> = {},
    ): Cell => ({
        target: target.label,
        scenario: scenario.id,
        suite: scenario.suite,
        verdict,
        detail,
        metrics,
        wallMs: Date.now() - started,
        log,
    })

    const gate = scenario.applies(target)
    if (gate) return done(gate.verdict, gate.reason)

    const { source } = target
    let fixtures: unknown[] | null = null
    if (source.kind === 'mock') {
        if (!scenario.mockFixtures) {
            return done('skip', 'no mock fixture for this scenario')
        }
        fixtures =
            typeof scenario.mockFixtures === 'function'
                ? scenario.mockFixtures(target)
                : scenario.mockFixtures
        fixtures = fixturesFor(target, fixtures)
    }

    let server: ModelServerLike | null = null
    let vault: string | null = null
    const chats: ChatDriver[] = []
    let sidecar: { stop(): Promise<void> } | null = null
    const savedEnv: Record<string, string | undefined> = {}
    try {
        if (fixtures) server = await deps.startModelServer({ fixtures })
        else if (source.kind === 'local') {
            server = await deps.startModelServer({ upstream: source.url })
        }
        vault = deps.seedVault(
            target,
            source.kind === 'local' && server
                ? { localModel: { url: server.url, model: source.model } }
                : source.kind === 'mock' && server
                  ? { localModel: { url: server.url, model: MOCK_MODEL } }
                  : undefined,
        )
        const env = deps.env?.(target, server, vault) ?? {}
        for (const [k, v] of Object.entries(env)) {
            savedEnv[k] = process.env[k]
            process.env[k] = v
        }
        sidecar = (await deps.sidecar?.(target, { ...process.env, ...env }, vault)) ?? null
        const v = vault
        const s = server
        const track = (d: ChatDriver) => {
            chats.push(d)
            return d
        }
        const ctx: ScenarioCtx = {
            target,
            vault: v,
            newChat: async () => {
                const d = track(deps.createChatDriver(target, v, line => log.push(line)))
                await d.open()
                return d
            },
            resumeChat: async id =>
                track(await deps.resumeChatDriver(target, v, id)),
            history: id => deps.historyFrames(target, v, id),
            bismuth: args => deps.bismuth(v, args),
            modelRequests: () => s?.requests() ?? [],
            setWindow: tokens => {
                if (!s) {
                    throw new Error(
                        `setWindow needs a mock or local target; ${target.label} has no model server`,
                    )
                }
                s.setWindow(tokens)
            },
            log: line => log.push(line),
        }
        const result = await within<ScenarioOutcome>(
            scenario.run(ctx),
            scenario.timeoutMs,
        )
        if (result === 'timeout') {
            return done('timeout', `no result within ${scenario.timeoutMs} ms`)
        }
        return done(result.verdict, result.detail, result.metrics ?? {})
    } catch (e) {
        return done('fail', message(e))
    } finally {
        for (const [k, v] of Object.entries(savedEnv)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
        await Promise.all(
            chats.map(c => within(c.close().catch(() => {}), 10_000)),
        )
        try {
            deps.resetBackends?.()
        } catch {}
        await (sidecar as { stop(): Promise<void> } | null)?.stop().catch(() => {})
        await server?.stop().catch(() => {})
        if (vault) {
            try {
                deps.removeVault?.(vault)
            } catch {}
        }
    }
}
