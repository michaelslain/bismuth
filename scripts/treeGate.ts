// scripts/treeGate.ts
//
// Typecheck + tests for a tree, skipping what already passed. `bun run gate:tree` is the merge
// verify and the pre-push gate; scripts/gate.ts (pre-commit) uses the same pieces.
//
//   1. HEAD's tree already passed this tier (scripts/passCache.ts) and the working tree is clean →
//      nothing runs.
//   2. HEAD is a merge commit whose two parents' trees both passed this tier → only the tests BOTH
//      sides' diffs can affect. A test only one side's diff reaches has the same inputs as on the
//      other parent, where it passed. A branch's own commits already ran its tests, so a merge of
//      disjoint work runs the always-run tests and nothing else.
//   3. A base tree that passed this tier → only the tests the diff from it can affect
//      (scripts/testGraph.ts), plus the always-run tests.
//   4. Otherwise → the whole tier.
//
// In the full tier (pre-push), a clean tree that already passed the fast tier runs only the slow
// suites in the selection, and no typecheck: every other test, and the typecheck, already passed
// on these exact files.
//
// The typecheck runs across every workspace (they import each other's source) at the same time as
// the tests, and is skipped when no code file changed. A clean working tree records its pass, so the
// next gate on the same tree, in any worktree, skips it.
//
//   bun run gate:tree                    # fast tier; base: the upstream, else HEAD~1
//   bun run gate:tree --base <rev>       # fast tier against this base (merge verify: --base "$M^1")
//   bun run gate:tree --full             # every test, slow suites included (pre-push)
//   bun run gate:tree --no-cache         # ignore and do not write pass records
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
    ensureTimings,
    runPhases,
    testPhases,
    timingsFile,
    type Phase,
} from './fastTests'
import {
    cacheFile,
    isGreen,
    readPasses,
    recordPass,
    treeOf,
    workingTreeClean,
    type Tier,
} from './passCache'
import {
    alwaysTests,
    buildGraph,
    selectTests,
    snapshotRepo,
    type Selection,
} from './testGraph'

export const WORKSPACES = [
    'core',
    'app',
    'cli',
    'mcp',
    'relay',
    'memory',
    'daemon',
] as const

const CODE_CHANGE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/

/** Does a change need the typecheck? Any code, config or stylesheet file does; docs do not. */
export function needsTypecheck(changed: string[] | 'all'): boolean {
    return changed === 'all' || changed.some(f => CODE_CHANGE.test(f))
}

/** Git's repo-location variables. Git injects them into every hook and they override path-based
 *  repo discovery, so a test that runs git in a temp dir would operate on this repo instead. */
const GIT_LOCATION_VARS = [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
    'GIT_COMMON_DIR',
    'GIT_NAMESPACE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
] as const

/** Strip git's repo-location vars from an environment. Pure. Leaves GIT_EXEC_PATH, GIT_CONFIG_*
 *  and identity alone: they change git's behaviour, not its target. */
export function sanitizeGitEnv(
    env: Record<string, string | undefined>,
): Record<string, string | undefined> {
    const out = { ...env }
    for (const k of GIT_LOCATION_VARS) delete out[k]
    return out
}

/** Start `tsc --noEmit` in every workspace at once; `wait()` resolves when all have exited. */
export function startTypecheck(env = sanitizeGitEnv(process.env)): {
    wait: () => Promise<{ ok: boolean; output: string; seconds: number }>
} {
    const started = Date.now()
    const procs = WORKSPACES.map(w => ({
        w,
        p: Bun.spawn(['bunx', 'tsc', '--noEmit'], {
            cwd: w,
            env: env as Record<string, string>,
            stdout: 'pipe',
            stderr: 'pipe',
        }),
    }))
    // When the last tsc exited, which is before `wait()` is called when the tests take longer.
    let finished = started
    for (const { p } of procs)
        void p.exited.then(() => (finished = Math.max(finished, Date.now())))
    return {
        wait: async () => {
            const results = await Promise.all(
                procs.map(async ({ w, p }) => {
                    const [out, err, code] = await Promise.all([
                        new Response(p.stdout).text(),
                        new Response(p.stderr).text(),
                        p.exited,
                    ])
                    return { w, ok: code === 0, output: out + err }
                }),
            )
            const failed = results.filter(r => !r.ok)
            return {
                ok: failed.length === 0,
                output: failed.map(r => `── ${r.w} ──\n${r.output}`).join('\n'),
                seconds: (finished - started) / 1000,
            }
        },
    }
}

/** Files that import core/test/slowGate.ts: their slow suites run only in the full tier. */
export function slowFiles(graph: ReturnType<typeof buildGraph>): string[] {
    return graph.tests.filter(t =>
        graph.deps.get(t)?.has('core/test/slowGate.ts'),
    )
}

export type TestPlan = {
    selection: Selection
    phases: Phase[]
    /** One line saying what runs and why. */
    summary: string
}

/** The tests both sides of a merge can affect: only those can fail on the merged tree when each
 *  side's tree passed. Pure. */
export function intersectSelections(a: Selection, b: Selection): Selection {
    if (a.all && b.all) return a
    if (a.all) return b
    if (b.all) return a
    const inB = new Set(b.files)
    return {
        all: false,
        files: a.files.filter(f => inB.has(f)),
        reasons: [...a.reasons, ...b.reasons],
    }
}

/** A selection narrowed to the slow-suite files, for a full-tier run on a tree whose fast tier
 *  already passed. Pure. */
export function onlySlowFiles(sel: Selection, slow: string[]): Selection {
    const files = sel.all ? [...slow] : sel.files.filter(f => slow.includes(f))
    return {
        all: false,
        files: files.sort(),
        reasons: sel.all ? [] : sel.reasons,
    }
}

export type PlanOptions = {
    /** A merge: the second parent's changed paths. Only tests both diffs select run. */
    otherSide?: string[] | 'all'
    /** The tree passed the fast tier: run only the selection's slow suites. */
    onlySlow?: boolean
}

/** The phases for a selection (or the whole tier). */
export function planTests(
    changed: string[] | 'all',
    tier: Tier,
    why: string,
    opts: PlanOptions = {},
): TestPlan {
    const graph = buildGraph(snapshotRepo())
    const always = alwaysTests(graph)
    const select = (c: string[] | 'all'): Selection =>
        c === 'all' ? { all: true, reason: why } : selectTests(c, graph, always)
    let selection = select(changed)
    if (opts.otherSide !== undefined)
        selection = intersectSelections(selection, select(opts.otherSide))
    const slow = slowFiles(graph)
    if (opts.onlySlow) selection = onlySlowFiles(selection, slow)
    const timings = timingsFile()
    ensureTimings(timings)
    const phases = testPhases({
        files: selection.all ? 'all' : selection.files,
        slow: tier === 'full',
        slowFiles: slow,
        timings,
    })
    const what = opts.onlySlow ? 'slow-suite file(s)' : 'test file(s)'
    const reach =
        opts.otherSide !== undefined
            ? 'both sides of the merge can reach'
            : 'the change can reach'
    const summary = selection.all
        ? `all tests (${selection.reason})`
        : `${selection.files.length} ${what} ${reach}`
    return { selection, phases, summary }
}

/** Where a failing gate's full output is saved, so the failure can be handed over by path. */
export function failureLogPath(): string {
    return join(cacheFile(), '..', 'last-failure.log')
}

export function saveFailureLog(text: string): string {
    const p = failureLogPath()
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, text)
    return p
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const short = (t: string) => t.slice(0, 10)

/**
 * Run typecheck (when needed) and the planned tests side by side. Prints one line per step, and the
 * failing step's output with the path of a saved copy.
 */
export async function runChecks(
    prefix: string,
    plan: TestPlan,
    typecheck: boolean,
    tier: Tier,
): Promise<boolean> {
    const tc = typecheck ? startTypecheck() : undefined
    const log: string[] = []
    let failedOutput = ''
    const testsOk = await runPhases(plan.phases, {
        label: prefix,
        slow: tier === 'full',
        quiet: true,
        env: sanitizeGitEnv(process.env),
        onPhase: (p, r) => {
            process.stdout.write(
                `${dim(`[${prefix}]`)} tests (${p.label})… ${r.ok ? '\x1b[32mok\x1b[0m' : '\x1b[31mFAILED\x1b[0m'} (${r.seconds.toFixed(1)}s)\n`,
            )
            log.push(`$ bun ${p.args.join(' ')}\n${r.output}`)
            if (!r.ok) failedOutput = r.output
        },
    })
    let tcOk = true
    if (tc) {
        const r = await tc.wait()
        tcOk = r.ok
        process.stdout.write(
            `${dim(`[${prefix}]`)} typecheck (all workspaces)… ${r.ok ? '\x1b[32mok\x1b[0m' : '\x1b[31mFAILED\x1b[0m'} (${r.seconds.toFixed(1)}s)\n`,
        )
        if (!r.ok) {
            log.unshift(`$ tsc --noEmit (per workspace)\n${r.output}`)
            failedOutput = r.output + '\n' + failedOutput
        }
    }
    if (testsOk && tcOk) return true
    const path = saveFailureLog(log.join('\n\n'))
    process.stdout.write('\n' + failedOutput.trimEnd() + '\n\n')
    process.stdout.write(`${dim(`[${prefix}]`)} full output: ${path}\n`)
    return false
}

/** Paths that differ between `base` and the working tree, untracked files included. */
export function changedSince(base: string): string[] {
    const diff = spawnSync(
        'git',
        ['diff', '--name-only', '--no-renames', base],
        { encoding: 'utf8' },
    )
    const untracked = spawnSync(
        'git',
        ['ls-files', '--others', '--exclude-standard'],
        { encoding: 'utf8' },
    )
    return [
        ...new Set(
            [diff.stdout, untracked.stdout]
                .join('\n')
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
        ),
    ]
}

/** A merge commit's two parents, or undefined for any other commit. */
export function mergeParents(rev = 'HEAD'): [string, string] | undefined {
    const r = spawnSync('git', ['rev-list', '--parents', '-n', '1', rev], {
        encoding: 'utf8',
    })
    const ids = (r.stdout ?? '').trim().split(/\s+/).slice(1)
    return r.status === 0 && ids.length === 2 ? [ids[0], ids[1]] : undefined
}

/** The first candidate base whose tree passed `tier`, or undefined. */
export function greenBase(
    candidates: string[],
    tier: Tier,
): { rev: string; tree: string } | undefined {
    const passes = readPasses()
    for (const rev of candidates) {
        const tree = treeOf(rev)
        if (tree && isGreen(tree, tier, passes)) return { rev, tree }
    }
    return undefined
}

function parseArgs(argv: string[]) {
    const get = (k: string) => {
        const i = argv.indexOf(k)
        return i >= 0 ? argv[i + 1] : undefined
    }
    return {
        full: argv.includes('--full'),
        noCache: argv.includes('--no-cache'),
        base: get('--base'),
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    const tier: Tier = args.full ? 'full' : 'fast'
    const prefix = args.full ? 'gate:tree --full' : 'gate:tree'
    const tree = treeOf('HEAD')
    const clean = workingTreeClean()
    if (!tree) {
        process.stdout.write(`[${prefix}] no HEAD commit\n`)
        process.exit(1)
    }
    if (!clean)
        process.stdout.write(
            dim(
                `[${prefix}] working tree has changes: testing it as it is, no pass recorded\n`,
            ),
        )
    if (!args.noCache && clean && isGreen(tree, tier, readPasses())) {
        process.stdout.write(
            `\x1b[32m[${prefix}] tree ${short(tree)} already passed (${tier})\x1b[0m — nothing to run\n`,
        )
        return
    }
    const passes = args.noCache ? [] : readPasses()
    // Full tier on a tree whose fast tier passed: the slow suites are all that is left.
    const onlySlow = tier === 'full' && clean && isGreen(tree, 'fast', passes)
    const parents = mergeParents()
    const both = parents?.map(p => ({ rev: p, tree: treeOf(p) }))
    const mergeGreen =
        !!both && both.every(p => p.tree && isGreen(p.tree, tier, passes))
    let base: { rev: string; tree: string } | undefined
    let changed: string[] | 'all'
    let otherSide: string[] | 'all' | undefined
    if (mergeGreen) {
        base = { rev: both![0].rev, tree: both![0].tree! }
        changed = changedSince(both![0].rev)
        otherSide = changedSince(both![1].rev)
    } else {
        const candidates = args.base
            ? [args.base]
            : ['@{upstream}', 'HEAD~1'].filter(r => treeOf(r))
        base = args.noCache ? undefined : greenBase(candidates, tier)
        changed = base ? changedSince(base.rev) : 'all'
    }
    const why = args.noCache ? '--no-cache' : 'no passed base'
    const plan = planTests(changed, tier, why, { otherSide, onlySlow })
    const from = mergeGreen
        ? `both merge parents passed → `
        : base
          ? `base ${base.rev} (${short(base.tree)}) passed → `
          : ''
    process.stdout.write(
        dim(
            `[${prefix}] ${from}${plan.summary}${onlySlow ? ' (fast tier already passed: no typecheck)' : ''}\n`,
        ),
    )
    // The typecheck reads every file: it can only change when both sides changed code.
    const typecheck =
        !onlySlow &&
        needsTypecheck(changed) &&
        (otherSide === undefined || needsTypecheck(otherSide))
    const ok = await runChecks(prefix, plan, typecheck, tier)
    if (!ok) {
        process.stdout.write(`\x1b[31m[${prefix}] failed\x1b[0m\n`)
        process.exit(1)
    }
    if (!args.noCache && clean && workingTreeClean())
        recordPass({ tree, tier, ...(base ? { base: base.tree } : {}) })
    process.stdout.write(
        `\x1b[32m[${prefix}] passed\x1b[0m${clean ? ` — tree ${short(tree)} recorded` : ''}\n`,
    )
}

if (import.meta.main) await main()
