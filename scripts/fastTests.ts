// scripts/fastTests.ts
//
// The fast suite as two phases: everything four files at a time, then the vault-watcher files one
// at a time. macOS FSEvents drops events when other processes churn files (measured: 36 of 40
// writes missed with four busy neighbours), and four parallel test workers are that churn, so a
// watcher test run beside them times out waiting for an event that was never delivered. Run alone
// the same files pass. Used by `bun run test:fast` and by scripts/gate.ts.
//
//   bun run scripts/fastTests.ts            # whole repo
//   bun run scripts/fastTests.ts core/ cli/ # only these workspace directories
import { spawnSync } from 'node:child_process'

/** Test files that wait on real fs.watch events; they run serially in phase two. */
export const WATCHER_TESTS = [
    'core/test/server.test.ts',
    'core/test/sseRefresh.test.ts',
    'core/test/liveWatch.test.ts',
    'core/test/bases/baseJsonlSurfaces.test.ts',
    'core/test/themesRoute.test.ts',
    'daemon/test/fileWatch.test.ts',
]

export type FastPhase = { label: string; args: string[] }

/** The `bun test` argument lists for the two phases. `dirs` are `cli/`-style workspace
 *  directories; none means the whole repo. */
export function fastPhases(dirs: string[] = []): FastPhase[] {
    const watchers = dirs.length
        ? WATCHER_TESTS.filter(f => dirs.some(d => f.startsWith(d)))
        : WATCHER_TESTS
    const phases: FastPhase[] = [
        {
            label: 'parallel',
            args: [
                'test',
                '--parallel=4',
                ...WATCHER_TESTS.map(f => `--path-ignore-patterns=${f}`),
                ...dirs,
            ],
        },
    ]
    if (watchers.length)
        phases.push({
            label: 'watchers, one at a time',
            args: ['test', ...watchers],
        })
    return phases
}

if (import.meta.main) {
    for (const { label, args } of fastPhases(process.argv.slice(2))) {
        process.stdout.write(`[test:fast] ${label}\n`)
        const r = spawnSync('bun', args, {
            stdio: 'inherit',
            env: { ...process.env, BISMUTH_FAST_TESTS: '1' },
        })
        if (r.status !== 0) process.exit(r.status ?? 1)
    }
}
