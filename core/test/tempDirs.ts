import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The one registry of throwaway dirs the test suite creates, and the sweep that removes them.
 *
 * WHY ITS OWN MODULE. The sweep must be registered from the PRELOAD (`core/test/setup.ts`, wired in
 * the root bunfig.toml), not from `helpers.ts`. A module is evaluated once per process, so an
 * `afterAll` at helpers' module scope registers for whichever test file imported it FIRST and for no
 * other — measured: with the hook in helpers, a full 157-file run still left 479 dirs behind, because
 * 156 files got the cached module and registered nothing. A preload's hooks apply to the whole run.
 * Both sides need the same array, so the array lives here and neither owns it.
 *
 * `process.on('exit')` alone is NOT sufficient either — also measured: under `bun test` it did not
 * fire at all, leaving every dir in place. It is kept only as a backstop.
 */
const TEMP_DIRS: string[] = []

/** Allocate a tracked throwaway dir. Test files must use this rather than calling `mkdtempSync`
 *  directly — a raw mkdtempSync is untracked and leaks, which is how /var/folders reached 9,255
 *  dirs (~106MB) before anyone noticed. */
export function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    TEMP_DIRS.push(dir)
    return dir
}

/** Remove every tracked dir. Idempotent — entries are dropped as they are removed, so running it
 *  from both the afterAll and the exit backstop costs nothing. Never throws: a cleanup failure must
 *  not turn a green suite red, since a leaked tmpdir is a nuisance and a false failure is worse. */
export function sweepTempDirs(): void {
    sweepList(TEMP_DIRS)
}

/** The sweep itself, over an ARBITRARY list. Split out so it is testable: a test that called
 *  `sweepTempDirs()` would delete the dirs every OTHER test file in the process is still using,
 *  since bun runs the suite in one process and the registry is shared. */
export function sweepList(dirs: string[]): void {
    while (dirs.length) {
        const d = dirs.pop()!
        try {
            rmSync(d, { recursive: true, force: true })
        } catch {
            /* best effort */
        }
    }
}

/** Track a dir this module did not allocate — for paths handed to a subsystem via an env var, which
 *  creates them lazily itself (the layout cache does exactly this). */
export function registerTempDir(dir: string): void {
    TEMP_DIRS.push(dir)
}

/** Count of dirs still tracked — used by the test that proves the sweep actually sweeps. */
export function trackedTempDirCount(): number {
    return TEMP_DIRS.length
}
