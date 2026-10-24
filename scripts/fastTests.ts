// scripts/fastTests.ts
//
// How the test suite runs: in phases, under the machine-wide test lock (scripts/testLock.ts).
//
//   1. parallel: every selected file except the two kinds below, across `testWorkers()` processes,
//      slowest file first (Bun's `--timings`, fed from the durations of earlier runs);
//   2. watchers, one at a time: the files in WATCHER_TESTS. macOS FSEvents drops events when other
//      processes churn files (measured: 36 of 40 writes missed with four busy neighbours), and the
//      parallel workers are that churn, so a watcher test beside them times out waiting for an event
//      that was never delivered;
//   3. slow suites, one at a time, only when the slow suites run (BISMUTH_FAST_TESTS unset): the
//      files that import core/test/slowGate.ts spawn real agent binaries, PTYs and websockets.
//
// Used by `bun run test:fast`, scripts/gate.ts and scripts/treeGate.ts.
//
//   bun run scripts/fastTests.ts            # the whole fast suite
//   bun run scripts/fastTests.ts core/ cli/ # only these workspace directories
import { spawnSync } from 'node:child_process'
import { cpus, totalmem } from 'node:os'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { acquireTestLock } from './testLock'

/** Test files that wait on real fs.watch events; they run serially in phase two. */
export const WATCHER_TESTS = [
    'core/test/server.test.ts',
    'core/test/sseRefresh.test.ts',
    'core/test/liveWatch.test.ts',
    'core/test/bases/baseJsonlSurfaces.test.ts',
    'core/test/themesRoute.test.ts',
    'daemon/test/fileWatch.test.ts',
]

/** Memory one parallel worker can use: a worker runs a test file and the processes it spawns. */
const WORKER_MEMORY = 2 * 1024 ** 3

/**
 * Parallel workers for this machine: half the cores (each worker's test file spawns its own
 * processes), capped by memory, at least 2. BISMUTH_TEST_WORKERS overrides it. One run at a time
 * holds the machine (the test lock), so the run can use it.
 */
export function testWorkers(
    env: Record<string, string | undefined> = process.env,
    cores = cpus().length,
    memory = totalmem(),
): number {
    const forced = Number(env.BISMUTH_TEST_WORKERS)
    if (Number.isInteger(forced) && forced > 0) return forced
    return Math.max(
        2,
        Math.min(Math.floor(cores / 2), Math.floor(memory / WORKER_MEMORY)),
    )
}

/** Per-file durations from earlier runs, for `--timings`; shared by every worktree. */
export function timingsFile(cwd = process.cwd()): string {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf8',
    })
    const common = r.stdout.trim() || '.git'
    const abs = isAbsolute(common) ? common : resolve(cwd, common)
    return join(abs, 'bismuth-gate', 'timings.json')
}

export function ensureTimings(file: string): void {
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 1, files: {} }) + '\n')
}

export type Phase = { label: string; args: string[] }

export type PhasePlan = {
    /** Test files to run; `'all'` runs the whole suite (positional dirs narrow it). */
    files: string[] | 'all'
    /** Workspace dirs (`core/`) narrowing an `'all'` run. */
    dirs?: string[]
    /** Files that import core/test/slowGate.ts; they run in phase three when `slow` is set. */
    slowFiles?: string[]
    /** Run the slow suites (BISMUTH_FAST_TESTS unset) as phase three. */
    slow?: boolean
    workers?: number
    timings?: string
}

/** `./`-prefixed, so Bun runs exactly that file instead of matching it as a substring. */
const exact = (f: string) => (f.startsWith('./') ? f : `./${f}`)

/** The `bun test` argument lists for each phase. Pure. */
export function testPhases(plan: PhasePlan): Phase[] {
    const workers = plan.workers ?? testWorkers()
    const timing = plan.timings
        ? [`--timings=${plan.timings}`, '--update-timings']
        : []
    const slowFiles = plan.slow ? (plan.slowFiles ?? []) : []
    const serial = new Set([...WATCHER_TESTS, ...slowFiles])
    const inScope = (f: string) =>
        plan.files === 'all'
            ? !plan.dirs?.length || plan.dirs.some(d => f.startsWith(d))
            : plan.files.includes(f)
    const phases: Phase[] = []
    const parallelArgs = ['test', `--parallel=${workers}`, ...timing]
    if (plan.files === 'all')
        phases.push({
            label: 'parallel',
            args: [
                ...parallelArgs,
                ...[...serial].map(f => `--path-ignore-patterns=${f}`),
                ...(plan.dirs ?? []),
            ],
        })
    else {
        const rest = plan.files.filter(f => !serial.has(f))
        if (rest.length)
            phases.push({
                label: 'parallel',
                args: [...parallelArgs, ...rest.map(exact)],
            })
    }
    const watchers = WATCHER_TESTS.filter(inScope)
    if (watchers.length)
        phases.push({
            label: 'watchers, one at a time',
            args: ['test', ...watchers.map(exact)],
        })
    const slow = slowFiles.filter(f => inScope(f) && !WATCHER_TESTS.includes(f))
    if (slow.length)
        phases.push({
            label: 'slow suites, one at a time',
            args: ['test', ...slow.map(exact)],
        })
    return phases
}

export type PhaseResult = { ok: boolean; output: string; seconds: number }

/**
 * Run phases in order under the test lock, stopping at the first failure. `quiet` captures each
 * phase's output (printed by the caller on failure); otherwise it streams. Async, so work started
 * beside it (the typecheck) keeps its event loop.
 */
export async function runPhases(
    phases: Phase[],
    opts: {
        label: string
        slow?: boolean
        quiet?: boolean
        env?: Record<string, string | undefined>
        onPhase?: (p: Phase, r: PhaseResult) => void
    },
): Promise<boolean> {
    if (!phases.length) return true
    const release = acquireTestLock(opts.label)
    try {
        for (const p of phases) {
            const started = Date.now()
            // `opts.env` replaces the environment rather than adding to it: a sanitized env is
            // defined by the keys it lacks.
            const env: Record<string, string | undefined> = {
                ...(opts.env ?? process.env),
            }
            if (process.env.BISMUTH_TEST_LOCK_HELD)
                env.BISMUTH_TEST_LOCK_HELD = process.env.BISMUTH_TEST_LOCK_HELD
            if (opts.slow) delete env.BISMUTH_FAST_TESTS
            else env.BISMUTH_FAST_TESTS = '1'
            const proc = Bun.spawn(['bun', ...p.args], {
                stdin: 'ignore',
                stdout: opts.quiet ? 'pipe' : 'inherit',
                stderr: opts.quiet ? 'pipe' : 'inherit',
                env: env as Record<string, string>,
            })
            const [out, err, code] = await Promise.all([
                opts.quiet
                    ? new Response(proc.stdout as ReadableStream).text()
                    : '',
                opts.quiet
                    ? new Response(proc.stderr as ReadableStream).text()
                    : '',
                proc.exited,
            ])
            const result = {
                ok: code === 0,
                output: out + err,
                seconds: (Date.now() - started) / 1000,
            }
            opts.onPhase?.(p, result)
            if (!result.ok) return false
        }
        return true
    } finally {
        release()
    }
}

if (import.meta.main) {
    const timings = timingsFile()
    ensureTimings(timings)
    const dirs = process.argv.slice(2)
    const phases = testPhases({ files: 'all', dirs, timings })
    const ok = await runPhases(phases, {
        label: 'test:fast',
        onPhase: (p, r) =>
            process.stdout.write(
                `[test:fast] ${p.label}: ${r.ok ? 'ok' : 'FAILED'} (${r.seconds.toFixed(1)}s)\n`,
            ),
    })
    if (!ok) process.exit(1)
}
