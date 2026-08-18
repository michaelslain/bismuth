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

    const targets = affectedWorkspaces(staged)
    if (targets.length === 0) {
        // Docs, design assets, .gitignore — nothing a test or the typechecker covers.
        process.stdout.write(
            '\x1b[2m[gate] no source workspace touched — skipping tests\x1b[0m\n',
        )
        process.exit(0)
    }

    process.stdout.write(
        `\x1b[2m[gate] ${staged.length} staged file(s) → testing: ${targets.join(', ')}\x1b[0m\n`,
    )

    let ok = run('typecheck (all workspaces)', 'bun', ['run', 'typecheck'])
    // Pass `cli/` not `cli`: `bun test <arg>` is a SUBSTRING match on the whole path, not a
    // workspace selector. Bare `cli` also matches core/test/chatProviders/clineMocked.test.ts
    // ("cli" is in "clineMocked"), so the gate silently ran 7 unrelated tests and reported a
    // count nobody could reconcile. The trailing slash scopes it to the directory.
    if (ok) {
        ok = run(
            `tests (fast) — ${targets.join(', ')}`,
            'bun',
            ['test', ...targets.map(t => `${t}/`)],
            {
                BISMUTH_FAST_TESTS: '1',
            },
        )
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
