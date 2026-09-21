// scripts/gate.ts
//
// The pre-commit gate: typecheck + tests, run automatically by .githooks/pre-commit.
//
// WHY IT IS SCOPED THE WAY IT IS. The full suite is ~150s (core alone), which is too slow to run
// on every commit — a gate people route around with --no-verify is worse than no gate. So this
// splits the difference along two axes:
//
//   1. SLOW SUITES ARE SKIPPED (BISMUTH_FAST_TESTS=1, see core/test/slowGate.ts). Those are the
//      suites that spawn real agent binaries, PTYs, websockets, or run the layout benchmark —
//      ~130s of the runtime for the parts least likely to break on an ordinary edit. pre-push
//      runs them.
//   2. ONLY AFFECTED WORKSPACES ARE TESTED, derived from the STAGED files. Editing app/ does not
//      re-run daemon/. A change to a shared root file (package.json, tsconfig.base.json, bun.lock,
//      scripts/) tests everything, because it can affect everything.
//
// Typecheck always runs across ALL workspaces regardless: it is ~12s and it is the only thing that
// catches a change in one workspace breaking another's types.
//
// A THIRD, INDEPENDENT step guards the design system: whenever a staged path touches app/src/,
// DESIGN.md, design/ or scripts/designSystem/ (see touchesDesignSystem below),
// this also runs the design-system gate (scripts/designSystem/gate.mjs — component/story/token
// conformance against DESIGN.md's governance block, ratcheted by design/baseline.json) and
// bench/tokenLint.ts (the literal-px/blurred-shadow/backdrop-filter sweep tokenLint still owns —
// see that file's header for the split of responsibility) as one combined step, so there is one
// design-system gate in pre-commit and no check runs twice.
//
// A FOURTH step, independent of the third, runs whenever a staged path matches app/src/**/*.css:
// bench/moduleClassCheck.ts, which builds the app (~11s) and cross-checks emitted CSS-Module class
// names. Narrowed to stylesheets as a cost tradeoff: a .tsx-only change that reintroduces a stale
// class literal is NOT caught here — run bench/moduleClassCheck.ts by hand for that case.
// against the emitted JS template output — the one migration mistake nothing else catches, a call
// site left holding an old plain-string class literal that compiles and renders but matches
// nothing once the real rule is hashed. It needs its own trigger (not touchesDesignSystem's) because
// it only cares about stylesheets, not components/stories/tokens, and it is the slowest step here
// (~11s, a full production build) so it should not run on a components-only or docs-only change.
//
// Escape hatches, in order of preference:
//   BISMUTH_SKIP_GATE=1 git commit …   — skip the gate, on purpose, visibly
//   git commit --no-verify             — skip every hook (blunter)
// Both are legitimate for a WIP commit on a branch. Neither should be how you land on main.
import { spawnSync } from 'node:child_process'

const WORKSPACES = [
    'core',
    'app',
    'cli',
    'mcp',
    'relay',
    'memory',
    'daemon',
] as const
type Workspace = (typeof WORKSPACES)[number]

/** Root-level paths that can affect every workspace, so touching one widens the gate to all. */
const SHARED_PREFIXES = [
    'package.json',
    'bun.lock',
    'tsconfig.base.json',
    'bunfig.toml',
    'scripts/',
    '.githooks/',
]

/**
 * Map staged file paths to the workspaces that need testing.
 * Exported (and pure) so gate.test.ts can pin the routing without touching git or the filesystem.
 */
export function affectedWorkspaces(staged: string[]): Workspace[] {
    if (staged.some(f => SHARED_PREFIXES.some(p => f === p || f.startsWith(p))))
        return [...WORKSPACES]
    const hit = new Set<Workspace>()
    for (const f of staged) {
        const ws = WORKSPACES.find(w => f.startsWith(`${w}/`))
        if (ws) hit.add(ws)
    }
    return WORKSPACES.filter(w => hit.has(w))
}

/**
 * Does this staged-file set touch anything the design-system gate + tokenLint care about?
 * Exported (and pure) so gate.test.ts can pin the routing without touching git or the filesystem.
 *
 * Covers: any app/src/** file (what both checks scan), DESIGN.md (the governance manifest both
 * checks parse), anything under design/ (the baseline debt ratchet and whatever design tooling
 * state joins it), and scripts/designSystem/**
 * (the copied checks themselves — a change there should prove itself against the repo it gates).
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

/**
 * Does this staged-file set touch a stylesheet moduleClassCheck needs to re-verify?
 * Exported (and pure) so gate.test.ts can pin the routing without touching git or the filesystem.
 *
 * Narrower than touchesDesignSystem: gated on stylesheets only as a cost tradeoff (the app build
 * this check needs is ~11s) — a .tsx-only commit that reintroduces a stale class literal is NOT
 * caught by this trigger; run bench/moduleClassCheck.ts by hand for that case.
 */
export function touchesStylesheets(staged: string[]): boolean {
    return staged.some(f => f.startsWith('app/src/') && f.endsWith('.css'))
}

export type GatePlan = {
    /** Run `bun run typecheck` across every workspace. */
    typecheck: boolean
    /** Which workspaces' fast test suites to run (empty = none). */
    tests: Workspace[]
    /** Run the design-system gate + tokenLint as the combined third step. */
    designSystem: boolean
    /** Run bench/moduleClassCheck.ts (builds the app) as the fourth step. */
    moduleClassCheck: boolean
}

/**
 * What a run of the gate would DO for this staged-file set, decided but not executed — the pure
 * core `main()` below consumes, so a regression in the decision (e.g. the design-system step
 * silently stopping tests) is a plain pinned-input/output test, not something only a live git
 * commit would exercise. Typecheck and the fast test suites always travel together: typecheck is
 * "did ANY workspace change enough to need testing at all", so it only runs when `tests` is
 * non-empty.
 */
export function plan(staged: string[]): GatePlan {
    const tests = affectedWorkspaces(staged)
    return {
        typecheck: tests.length > 0,
        tests,
        designSystem: touchesDesignSystem(staged),
        moduleClassCheck: touchesStylesheets(staged),
    }
}

/** Staged files, relative to the repo root. Added/copied/modified/renamed only — a pure deletion
 *  cannot break a test by its content. */
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

/**
 * Git's repo-location environment variables. Git injects these into every hook it runs, and they
 * OVERRIDE path-based repo discovery — including `git -C <dir>`, which only changes where paths
 * resolve, not which repository is operated on.
 *
 * That matters here because this gate spawns test suites, and some of those suites shell out to
 * git against throwaway directories (core/src/backup.ts's `ensureRepo`/`commitVault` git-init and
 * commit temp vaults). Inherited unchanged, those nested calls resolve to THIS repository instead
 * of the temp dir they were pointed at — writing its index, and re-entering its own hooks.
 */
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

/**
 * Strip git's repo-location vars from an environment. PURE — exported so gate.test.ts can pin it
 * without spawning anything.
 *
 * Deliberately narrow: it removes only the vars that redirect which repo a git call operates on.
 * GIT_EXEC_PATH, GIT_CONFIG_*, author/committer identity and the like are left alone — they change
 * git's behaviour, not its target, and a test that legitimately wants them should keep them.
 */
export function sanitizeGitEnv(
    env: Record<string, string | undefined>,
): Record<string, string | undefined> {
    const out = { ...env }
    for (const k of GIT_LOCATION_VARS) delete out[k]
    return out
}

function run(
    label: string,
    cmd: string,
    args: string[],
    env: Record<string, string> = {},
): boolean {
    process.stdout.write(`\x1b[2m[gate]\x1b[0m ${label}… `)
    const started = Date.now()
    const r = spawnSync(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        env: { ...sanitizeGitEnv(process.env), ...env } as NodeJS.ProcessEnv,
    })
    const secs = ((Date.now() - started) / 1000).toFixed(1)
    if (r.status === 0) {
        process.stdout.write(`\x1b[32mok\x1b[0m (${secs}s)\n`)
        return true
    }
    process.stdout.write(`\x1b[31mFAILED\x1b[0m (${secs}s)\n\n`)
    // Only the failing command's output, so the reason is the first thing on screen.
    process.stdout.write((r.stdout ?? '') + (r.stderr ?? '') + '\n')
    return false
}

function main(): void {
    if (process.env.BISMUTH_SKIP_GATE === '1') {
        process.stdout.write(
            '\x1b[33m[gate] skipped (BISMUTH_SKIP_GATE=1)\x1b[0m\n',
        )
        process.exit(0)
    }

    const staged = stagedFiles()
    if (staged.length === 0) {
        process.stdout.write(
            '\x1b[2m[gate] nothing staged — nothing to check\x1b[0m\n',
        )
        process.exit(0)
    }

    const { typecheck, tests, designSystem, moduleClassCheck } = plan(staged)
    if (tests.length === 0 && !designSystem && !moduleClassCheck) {
        // Docs, design assets, .gitignore — nothing a test, the typechecker or the design-system
        // gate covers.
        process.stdout.write(
            '\x1b[2m[gate] no source workspace touched — skipping tests\x1b[0m\n',
        )
        process.exit(0)
    }

    process.stdout.write(
        `\x1b[2m[gate] ${staged.length} staged file(s) → testing: ${tests.join(', ') || '(none)'}${designSystem ? ' + design system' : ''}${moduleClassCheck ? ' + moduleClassCheck' : ''}\x1b[0m\n`,
    )

    let ok = true
    if (typecheck) {
        ok = run('typecheck (all workspaces)', 'bun', ['run', 'typecheck'])
        // Pass `cli/` not `cli`: `bun test <arg>` is a SUBSTRING match on the whole path, not a
        // workspace selector. Bare `cli` also matches core/test/chatProviders/clineMocked.test.ts
        // ("cli" is in "clineMocked"), so the gate silently ran 7 unrelated tests and reported a
        // count nobody could reconcile. The trailing slash scopes it to the directory.
        if (ok) {
            ok = run(
                `tests (fast) — ${tests.join(', ')}`,
                'bun',
                ['test', ...tests.map(t => `${t}/`)],
                {
                    BISMUTH_FAST_TESTS: '1',
                },
            )
        }
    }

    // One combined design-system step: the manifest/story/token gate AND tokenLint's literal-px/
    // shadow/backdrop-filter sweep, so there is one design-system gate in pre-commit, not two.
    if (ok && designSystem) {
        // gate.mjs reads design/baseline.json on its own when it exists
        const gateArgs = ['scripts/designSystem/gate.mjs', '--root', '.']
        ok = run('design system (manifest + stories + tokens)', process.execPath, gateArgs)
        if (ok) ok = run('design system (tokenLint)', 'bun', ['bench/tokenLint.ts'])
    }

    // A fourth, independent step: moduleClassCheck builds the app and cross-checks emitted CSS
    // class names against the emitted JS, catching a stale string-literal class no other check
    // sees. It runs only on staged stylesheet changes, since it is the slowest step here (a full
    // production build, ~11s measured on this repo).
    if (ok && moduleClassCheck) {
        ok = run('moduleClassCheck (emitted CSS ↔ JS)', 'bun', ['bench/moduleClassCheck.ts'])
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

if (import.meta.main) main()
