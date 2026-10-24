// scripts/gate.ts
//
// The pre-commit gate, run by .githooks/pre-commit. It checks the working tree that `git commit`
// is about to record, in four steps:
//
//   1. TYPECHECK across every workspace (they import each other's source), when a code file
//      changed, at the same time as step 2.
//   2. TESTS the change can reach. scripts/testGraph.ts selects every test file that loads, names
//      or reads a changed file, in any workspace, plus the always-run tests; slow suites are
//      skipped (BISMUTH_FAST_TESTS=1, see core/test/slowGate.ts) and pre-push runs them. When the
//      index's tree already passed (scripts/passCache.ts), steps 1 and 2 are skipped, and a pass
//      here is recorded for the next gate on the same tree.
//   3. DESIGN SYSTEM, whenever a staged path touches app/src/, DESIGN.md, design/ or
//      scripts/designSystem/: scripts/designSystem/gate.mjs (component/story/token conformance
//      against DESIGN.md's governance block, ratcheted by design/baseline.json) and
//      bench/tokenLint.ts (the literal-px/blurred-shadow/backdrop-filter sweep) as one step.
//   4. bench/moduleClassCheck.ts, whenever a staged path is an app/src/**/*.css file. It builds the
//      app (~11s) and cross-checks emitted CSS-Module class names against the emitted JS, catching
//      a call site left holding an old plain-string class literal. A .tsx-only change that
//      reintroduces one is not caught here; run bench/moduleClassCheck.ts by hand for that case.
//
// Escape hatches, in order of preference:
//   BISMUTH_SKIP_GATE=1 git commit …   — skip the gate, on purpose, visibly
//   git commit --no-verify             — skip every hook (blunter)
// Both are legitimate for a WIP commit on a branch. Neither should be how you land on main.
import { spawnSync } from 'node:child_process'
import {
    indexTree,
    isGreen,
    readPasses,
    recordPass,
    treeOf,
    workingTreeMatchesIndex,
} from './passCache'
import {
    changedSince,
    needsTypecheck,
    planTests,
    runChecks,
    sanitizeGitEnv,
} from './treeGate'

export { sanitizeGitEnv }

/**
 * Does this staged-file set touch anything the design-system gate + tokenLint care about?
 * Covers: any app/src/** file (what both checks scan), DESIGN.md (the governance manifest both
 * parse), anything under design/ (the baseline debt ratchet), and scripts/designSystem/** (the
 * checks themselves, which should prove themselves against the repo they gate).
 */
export function touchesDesignSystem(staged: string[]): boolean {
    return staged.some(
        f =>
            f.startsWith('app/src/') ||
            f === 'DESIGN.md' ||
            f.startsWith('design/') ||
            f.startsWith('scripts/designSystem/'),
    )
}

/** Does this staged-file set touch a stylesheet moduleClassCheck needs to re-verify? Narrower
 *  than touchesDesignSystem: the app build it needs is ~11s, so it runs on stylesheets only. */
export function touchesStylesheets(staged: string[]): boolean {
    return staged.some(f => f.startsWith('app/src/') && f.endsWith('.css'))
}

export type GatePlan = {
    /** Run the typecheck: a code, config or stylesheet file changed. */
    typecheck: boolean
    /** Run the selected tests: anything changed. */
    tests: boolean
    /** Run the design-system gate + tokenLint as step three. */
    designSystem: boolean
    /** Run bench/moduleClassCheck.ts (builds the app) as step four. */
    moduleClassCheck: boolean
}

/** What a run of the gate does for these changed paths (working tree vs HEAD) and staged paths.
 *  Pure. */
export function plan(changed: string[], staged: string[] = changed): GatePlan {
    return {
        typecheck: needsTypecheck(changed),
        tests: changed.length > 0,
        designSystem: touchesDesignSystem(staged),
        moduleClassCheck: touchesStylesheets(staged),
    }
}

/** Staged files, relative to the repo root: added, copied, modified or renamed. */
function stagedFiles(): string[] {
    const r = spawnSync(
        'git',
        ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        { encoding: 'utf8' },
    )
    if (r.status !== 0) return []
    return r.stdout
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
}

function run(label: string, cmd: string, args: string[]): boolean {
    process.stdout.write(`\x1b[2m[gate]\x1b[0m ${label}… `)
    const started = Date.now()
    const r = spawnSync(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: sanitizeGitEnv(process.env) as NodeJS.ProcessEnv,
    })
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (r.status === 0) {
        process.stdout.write(`\x1b[32mok\x1b[0m (${secs}s)\n`)
        return true
    }
    process.stdout.write(`\x1b[31mFAILED\x1b[0m (${secs}s)\n\n`)
    process.stdout.write((r.stdout ?? '') + (r.stderr ?? '') + '\n')
    return false
}

async function main(): Promise<void> {
    if (process.env.BISMUTH_SKIP_GATE === '1') {
        process.stdout.write(
            '\x1b[33m[gate] skipped (BISMUTH_SKIP_GATE=1)\x1b[0m\n',
        )
        process.exit(0)
    }

    const staged = stagedFiles()
    const head = treeOf('HEAD')
    const changed = head ? changedSince('HEAD') : staged
    if (staged.length === 0 && changed.length === 0) {
        process.stdout.write(
            '\x1b[2m[gate] nothing staged — nothing to check\x1b[0m\n',
        )
        process.exit(0)
    }

    const steps = plan(changed, staged)
    const tree = indexTree()
    const exact = workingTreeMatchesIndex()
    let ok = true
    if (steps.tests || steps.typecheck) {
        if (exact && tree && isGreen(tree, 'fast', readPasses()))
            process.stdout.write(
                `\x1b[2m[gate] tree ${tree.slice(0, 10)} already passed — typecheck and tests skipped\x1b[0m\n`,
            )
        else {
            const tests = planTests(
                head ? changed : 'all',
                'fast',
                'first commit',
            )
            process.stdout.write(
                `\x1b[2m[gate] ${changed.length} changed file(s) → ${tests.summary}${steps.designSystem ? ' + design system' : ''}${steps.moduleClassCheck ? ' + moduleClassCheck' : ''}\x1b[0m\n`,
            )
            ok = await runChecks('gate', tests, steps.typecheck, 'fast')
            if (ok && exact && tree)
                recordPass({
                    tree,
                    tier: 'fast',
                    ...(head && !tests.selection.all ? { base: head } : {}),
                })
        }
    }

    // One combined design-system step: the manifest/story/token gate AND tokenLint's literal-px/
    // shadow/backdrop-filter sweep, so there is one design-system gate in pre-commit, not two.
    if (ok && steps.designSystem) {
        // gate.mjs reads design/baseline.json on its own when it exists
        const gateArgs = ['scripts/designSystem/gate.mjs', '--root', '.']
        ok = run(
            'design system (manifest + stories + tokens)',
            process.execPath,
            gateArgs,
        )
        if (ok)
            ok = run('design system (tokenLint)', 'bun', ['bench/tokenLint.ts'])
    }

    if (ok && steps.moduleClassCheck) {
        ok = run('moduleClassCheck (emitted CSS ↔ JS)', 'bun', [
            'bench/moduleClassCheck.ts',
        ])
    }

    if (!ok) {
        process.stdout.write(
            '\x1b[31m[gate] commit blocked.\x1b[0m Fix the above, or bypass deliberately:\n' +
                '  BISMUTH_SKIP_GATE=1 git commit …   (skip just this gate)\n' +
                '  git commit --no-verify             (skip all hooks)\n',
        )
        process.exit(1)
    }
    process.stdout.write(
        '\x1b[32m[gate] passed\x1b[0m — slow suites deferred to pre-push\n',
    )
}

if (import.meta.main) await main()
