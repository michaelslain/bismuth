import { setDefaultTimeout } from 'bun:test'

/**
 * The per-test timeout for a file whose tests start real processes (a CLI, a shell, a fake
 * server binary) or boot a real server. Bun's 5s default is fine on an idle machine, but process
 * start-up scales with CPU contention: under `bun test --parallel` beside other sessions' suites, a
 * spawn that takes 0.3s idle takes several seconds, and the test fails on the clock while the
 * behaviour it asserts is fine.
 *
 * This budgets for the spawns, not for the work: a test that genuinely hangs still fails, just
 * later. An explicit third argument to `test()` still wins.
 */
export const SPAWN_TIMEOUT_MS = 30_000

/** Call once at the top of a spawn-heavy test file. `setDefaultTimeout` is scoped to that file. */
export function useSpawnBudget(): void {
    setDefaultTimeout(SPAWN_TIMEOUT_MS)
}
