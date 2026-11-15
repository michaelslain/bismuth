// bench/backendBench.ts — the backend benchmark CLI. See `bun bench/backendBench.ts --help`.
//
// The parent runs one child process per target (`--worker`), so a backend's env and crashes stay its
// own. Each child streams `CELL <json>` lines; the parent collects them, scores against the
// reference target and writes `<out>/<stamp>.json` + `.md`.
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { cpus, freemem, homedir, loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { arg, has } from './args'
import { renderMatrix, score, writeReport } from './backendBench/report'
import { loadScenarios, runTarget, type RunDeps } from './backendBench/run'
import type {
    BenchReport,
    BenchTarget,
    Cell,
    Scenario,
} from './backendBench/types'

const REPO = join(import.meta.dir, '..')
const WATCHDOG = join(homedir(), '.claude/skills/execute/scripts/watchdog')
const CHILD_MB = 600
const csv = (name: string) =>
    arg(name)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

const HELP = `bench:backends — run every chat backend through the same scenarios and compare

Usage
  bun bench/backendBench.ts --all [--source mock,local]
  bun bench/backendBench.ts --target <label,...> [--scenario <id,...>]

Flags
  --target <label,...>  rows to run, e.g. claude@mock,opencode@mock,opencode@lmstudio:qwen/qwen3.5-9b
  --all                 every installed backend x the sources chosen by --source
  --source <list>       mock, local, cloud (default mock,local); cloud spends real model calls
  --suite <name,...>    only these suites (default every suite)
  --scenario <id,...>   only these scenario ids
  --reference <label>   the row every other row is scored against (default claude@mock)
  --home real|clean     real keeps your HOME and CLI configs (default); clean uses a throwaway home
  --out <dir>           report directory (default <repo>/.claude/bench/backends)
  --json                print the report as JSON on stdout instead of the markdown matrix

Examples
  bun bench/backendBench.ts --target opencode@mock --scenario reply
  bun bench/backendBench.ts --all --source mock
  bun bench/backendBench.ts --target claude@cloud --scenario reply,tool-bismuth

Progress goes to stderr; stdout is the matrix (or JSON). Exit 0 when the run completed, whatever
the verdicts; 2 for bad usage.`

function die(msg: string, code = 2): never {
    console.error(`Error: ${msg}`)
    process.exit(code)
}

async function realDeps(home: 'real' | 'clean'): Promise<RunDeps> {
    const vault = await import('./backendBench/vault')
    const mock = await import('./backendBench/mock')
    const driver = await import('./backendBench/driver')
    const targets = await import('./backendBench/targets')
    const { stopAllOpencodeServers } = await import(
        '../core/src/chatProviders/opencode/opencodeServer'
    )
    // Per scenario vault: the env dir (mock config + clean home live OUTSIDE the vault) and, for the
    // `bismuth` commands that need a running core, a core booted on a free port for that vault.
    const envDirs = new Map<string, string>()
    const cores = new Map<string, Promise<CoreHandle>>()
    return {
        seedVault: vault.seedVault,
        startModelServer: mock.startModelServer,
        createChatDriver: driver.createChatDriver,
        resumeChatDriver: driver.resumeChatDriver,
        historyFrames: driver.historyFrames,
        env: (t, server, v) => {
            const dir = mkdtempSync(join(tmpdir(), 'bench-env-'))
            envDirs.set(v, dir)
            return targets.targetEnv(t, (server as never) ?? null, dir, home, {
                vaultRoot: v,
            })
        },
        sidecar: async (t, env) => {
            if (t.backend !== 'openclaw' || t.source.kind !== 'mock') return null
            const { startOpenclawGateway } = await import(
                '../core/test/support/openclawGateway'
            )
            return targets.startOpenclawGatewayRetrying(env, startOpenclawGateway)
        },
        resetBackends: () => stopAllOpencodeServers(),
        removeVault: v => {
            const core = cores.get(v)
            cores.delete(v)
            core?.then(c => c.stop()).catch(() => {})
            const dir = envDirs.get(v)
            envDirs.delete(v)
            if (dir) rmSync(dir, { recursive: true, force: true })
            rmSync(v, { recursive: true, force: true })
        },
        bismuth: async (v, args) => {
            const flags = ['--vault', v]
            if (SERVER_COMMANDS.has(args[0] ?? '')) {
                let core = cores.get(v)
                if (!core) cores.set(v, (core = startCore(v)))
                flags.push('--api', (await core).url)
            }
            const p = Bun.spawn(
                ['bun', join(REPO, 'cli/src/index.ts'), ...args, ...flags],
                {
                stdout: 'pipe',
                stderr: 'pipe',
                },
            )
            const [stdout, stderr] = await Promise.all([
                new Response(p.stdout).text(),
                new Response(p.stderr).text(),
            ])
            return { code: await p.exited, stdout, stderr }
        },
    }
}

/** `bismuth` commands that talk to a running core (docs/cli/reference.md); the rest run headless. */
const SERVER_COMMANDS = new Set(['chat'])

type CoreHandle = { url: string; stop(): void }

/** Boots `core/src/server.ts` on a free port (never 4321) for one scenario vault and resolves once
 *  it prints its listening line. `stop()` kills only this process and removes its memory dir. */
async function startCore(vault: string): Promise<CoreHandle> {
    const probe = Bun.serve({ port: 0, fetch: () => new Response('') })
    const port = probe.port
    probe.stop(true)
    const memory = mkdtempSync(join(tmpdir(), 'bench-memory-'))
    const proc = Bun.spawn(
        [
            'bun',
            join(REPO, 'core/src/server.ts'),
            '--vault',
            vault,
            '--memory',
            memory,
            '--port',
            String(port),
        ],
        {
            env: { ...process.env, BROWSER: 'none' },
            stdout: 'ignore',
            stderr: 'pipe',
        },
    )
    // keep only the tail of stderr, and keep draining it so a chatty core never blocks on a full pipe
    let stderrTail = ''
    void (async () => {
        const dec = new TextDecoder()
        for await (const chunk of proc.stderr)
            stderrTail = (stderrTail + dec.decode(chunk)).slice(-2000)
    })()
    const stop = () => {
        try {
            proc.kill()
        } catch {}
        rmSync(memory, { recursive: true, force: true })
    }
    const url = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
        try {
            const r = await fetch(url)
            if (r.status > 0) return { url, stop }
        } catch {}
        await Bun.sleep(150)
    }
    stop()
    throw new Error(
        `core for ${vault} did not start on :${port} within 30s; run \`bun core/src/server.ts --vault <dir> --memory <dir> --port ${port}\` to see why${stderrTail ? `\n${stderrTail.trim()}` : ''}`,
    )
}

async function worker() {
    const raw = process.env.BENCH_TARGET
    if (!raw) die('--worker is internal; run without it')
    const target = JSON.parse(raw) as BenchTarget
    const scenarios = await loadScenarios({
        suites: csv('suite'),
        ids: csv('scenario'),
    })
    const home = arg('home', 'real') === 'clean' ? 'clean' : 'real'
    await runTarget(target, scenarios, await realDeps(home))
    process.exit(0)
}

type Child = { target: BenchTarget; key: string }

/** Runs one child, resolving with every cell it printed. A child that dies marks the scenarios it
 *  never reached `fail` with the stderr tail. */
async function runChild(
    target: BenchTarget,
    scenarios: Scenario[],
    passthrough: string[],
): Promise<Cell[]> {
    const budget = Math.ceil(
        scenarios.reduce((n, s) => n + s.timeoutMs, 0) / 1000 + 60,
    )
    const cmd = [
        'bun',
        join(REPO, 'bench/backendBench.ts'),
        '--worker',
        target.label,
        '--scenario',
        scenarios.map(s => s.id).join(','),
        ...passthrough,
    ]
    const argv = existsSync(WATCHDOG)
        ? ['perl', WATCHDOG, String(budget), ...cmd]
        : cmd
    const proc = Bun.spawn(argv, {
        env: { ...process.env, BENCH_TARGET: JSON.stringify(target), BROWSER: 'none' },
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const cells: Cell[] = []
    let errText = ''
    const readOut = (async () => {
        let buf = ''
        const dec = new TextDecoder()
        for await (const chunk of proc.stdout) {
            buf += dec.decode(chunk)
            let i
            while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i)
                buf = buf.slice(i + 1)
                if (!line.startsWith('CELL ')) continue
                try {
                    const c = JSON.parse(line.slice(5)) as Cell
                    cells.push(c)
                    console.error(
                        `${c.target} ${c.suite}/${c.scenario} ${c.verdict}`,
                    )
                } catch {}
            }
        }
    })()
    const readErr = (async () => {
        for await (const chunk of proc.stderr) errText += new TextDecoder().decode(chunk)
    })()
    const code = await proc.exited
    await Promise.all([readOut, readErr])
    const missing = scenarios.filter(
        s => !cells.some(c => c.scenario === s.id),
    )
    if (missing.length) {
        const tail = errText.trim().split('\n').slice(-8).join('\n')
        for (const s of missing) {
            cells.push({
                target: target.label,
                scenario: s.id,
                suite: s.suite,
                verdict: 'fail',
                detail: `worker for ${target.label} exited ${code} before this scenario finished: ${tail || '(no stderr)'}`,
                metrics: {},
                wallMs: 0,
                log: [],
            })
        }
    }
    return cells
}

/** How many non-local children run at once: free cores and free memory, whichever is smaller. */
function parallelism(): number {
    const cores = Math.floor(cpus().length - loadavg()[0])
    const mem = Math.floor(freemem() / (CHILD_MB * 1e6))
    return Math.max(1, Math.min(cores, mem))
}

async function schedule(
    children: Child[],
    run: (c: Child) => Promise<Cell[]>,
): Promise<Cell[]> {
    const queue = [...children]
    const busy = new Set<string>()
    const out: Cell[] = []
    const slots = parallelism()
    let active = 0
    return new Promise(resolve => {
        const pump = () => {
            while (active < slots) {
                const i = queue.findIndex(c => !c.key || !busy.has(c.key))
                if (i < 0) break
                const [c] = queue.splice(i, 1)
                active++
                if (c!.key) busy.add(c!.key)
                run(c!)
                    .then(cells => out.push(...cells))
                    .finally(() => {
                        active--
                        if (c!.key) busy.delete(c!.key)
                        pump()
                    })
            }
            if (!queue.length && !active) resolve(out)
        }
        pump()
    })
}

async function main() {
    if (has('help') || has('h')) {
        console.log(HELP)
        return
    }
    if (has('worker')) return worker()

    const sources = (csv('source').length ? csv('source') : ['mock', 'local'])
    const bad = sources.filter(s => !['mock', 'local', 'cloud'].includes(s))
    if (bad.length) {
        die(`unknown --source '${bad.join(',')}'; use mock, local or cloud`)
    }
    const home = arg('home', 'real')
    if (home !== 'real' && home !== 'clean') {
        die(`--home takes real or clean, not '${home}'`)
    }
    if (!has('all') && !csv('target').length) {
        die('nothing to run. Pass --all, or --target <label,...> (see --help for labels)')
    }

    let scenarios: Scenario[]
    try {
        scenarios = await loadScenarios({
            suites: csv('suite'),
            ids: csv('scenario'),
        })
    } catch (e) {
        die(e instanceof Error ? e.message : String(e))
    }
    if (!scenarios.length) die('no scenarios match --suite/--scenario')

    const targetsMod = await import('./backendBench/targets')
    let targets: BenchTarget[]
    if (has('all')) {
        targets = await targetsMod.discoverTargets({
            sources: sources as ('cloud' | 'mock' | 'local')[],
        })
    } else {
        const labels = csv('target')
        const parsed = labels.map(l => targetsMod.parseTargetLabel(l))
        const found = await targetsMod.discoverTargets({
            sources: [...new Set(parsed.map(p => p.source.kind))],
            backends: [...new Set(parsed.map(p => p.backend))],
        })
        const missing = labels.filter(l => !found.some(t => t.label === l))
        if (missing.length) {
            die(
                `no such target '${missing.join("', '")}'. Run --all to list the rows this machine has`,
            )
        }
        targets = labels.map(l => found.find(t => t.label === l)!)
    }
    if (!targets.length) die('no targets found: no backend is installed for those sources')

    const reference = arg('reference', 'claude@mock')
    const out = arg('out', join(REPO, '.claude/bench/backends'))
    const startedAt = new Date().toISOString()
    const passthrough = ['--home', home]
    const children: Child[] = targets.map(t => ({
        target: t,
        key: t.source.kind === 'local' ? `local:${t.source.server}` : '',
    }))
    const cells = await schedule(children, c =>
        runChild(c.target, scenarios, passthrough),
    )
    cells.sort(
        (a, b) =>
            targets.findIndex(t => t.label === a.target) -
                targets.findIndex(t => t.label === b.target) ||
            scenarios.findIndex(s => s.id === a.scenario) -
                scenarios.findIndex(s => s.id === b.scenario),
    )
    const report: BenchReport = {
        startedAt,
        finishedAt: new Date().toISOString(),
        reference,
        targets,
        cells,
        scores: score(cells, reference),
    }
    const files = writeReport(report, out)
    console.error(`wrote ${files.json}\nwrote ${files.md}`)
    console.log(has('json') ? JSON.stringify(report, null, 2) : renderMatrix(report))
}

main().catch(e => {
    console.error(`Error: ${e instanceof Error ? e.message : e}\n  Run with --help for usage.`)
    process.exit(1)
})
