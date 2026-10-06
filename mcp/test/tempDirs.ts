import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Workspace copy of core/test/tempDirs.ts (mcp never imports core, so it carries its own helper).
// There is no preload here, so each test file calls `afterAll(sweepTempDirs)` itself; the exit
// hook is only a backstop.
const TEMP_DIRS: string[] = []

/** Allocate a tracked throwaway dir. Test files must use this rather than a raw `mkdtempSync`. */
export function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    TEMP_DIRS.push(dir)
    return dir
}

/** Remove every tracked dir. Idempotent; never throws. */
export function sweepTempDirs(): void {
    sweepList(TEMP_DIRS)
}

/** The sweep over an arbitrary list, so it is testable without touching the shared registry. */
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

/** Track a dir this module did not allocate. */
export function registerTempDir(dir: string): void {
    TEMP_DIRS.push(dir)
}

/** Count of dirs still tracked. */
export function trackedTempDirCount(): number {
    return TEMP_DIRS.length
}

process.on('exit', sweepTempDirs)
