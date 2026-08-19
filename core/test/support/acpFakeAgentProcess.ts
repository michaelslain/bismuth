import { tempDir } from '../tempDirs'
// core/test/support/acpFakeAgentProcess.ts
// Shared "no orphaned fake-agent process" plumbing for every fakeAcpAgent.ts-driven test file that
// spawns a REAL child process (a stub binary that `exec`s into `bun run fakeAcpAgent.ts`).
//
// WHY THIS EXISTS (extracted during task-10's review, one wave after task-9's
// acpAbortFakeAgent.test.ts first wrote this exact logic inline): a chat backend's `closeChat()` only
// SENDS a signal — SIGTERM, escalating to SIGKILL after driver.ts's own KILL_ESCALATION_GRACE_MS if
// the process ignores it — it does not wait for the process to actually exit. A test file whose
// `afterEach` is synchronous (calls `closeChat()`, then `rmSync()`s its temp dirs, then returns) can
// complete successfully even when the child is still alive at that exact instant, because nothing
// polled for or asserted its death. acpAbortFakeAgent.test.ts got this right (pid-file capture +
// bounded async poll + throw-on-survival in an `async afterEach`) specifically BECAUSE that task's own
// subject was abort/never-terminating-turn behavior — but the guard lived in that one file and did not
// propagate to acpQueueFakeAgent.test.ts (task-10), which is why it's being pulled out now: three more
// fakeAcpAgent.ts-driven test files are coming in later waves (T11 session/load rejection, T12 live
// tool-use, T13 crash/malformed framing) and would otherwise each need to reinvent — or, worse, forget
// — the same ~40 lines. One copy, one place to fix it (mirrors chatFrameCollector.ts's own
// consolidation for the identical reason).
//
// This module deliberately does NOT wrap `closeChat()` itself — every consumer's own chat backend and
// call shape differs slightly (see acpAbortFakeAgent.test.ts's own multi-step abort scenario vs a
// plain queue test's single closeChat loop) — it only owns the pid lifecycle: writing a stub that
// records its own pid, waiting for that pid to be known, and proving every one of them is actually
// gone before a test's teardown is allowed to succeed silently.
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** True iff `pid` still names a live process — an OWNED, exact-pid point check (never a machine-wide
 *  `pgrep -f` pattern match, which cannot distinguish a process a test started from an unrelated one
 *  already running under the same name on the same machine — this project's own explicit constraint
 *  for orphan verification). Mirrors openclawMocked.test.ts's/opencodeMocked.test.ts's/
 *  acpAbortFakeAgent.test.ts's three (until now) separately-written identical copies. */
export function pidAlive(pid: number): boolean {
    return Bun.spawnSync(['ps', '-p', String(pid)]).exitCode === 0
}

/**
 * Creates a throwaway temp dir and writes an executable stub named `binaryName` into it that records
 * ITS OWN (post-`exec`, therefore stable) pid to `pidFile` before handing off to `fakeAgentScript` —
 * the precondition for `waitForPidFile`/`waitProcessesGone` to have a concrete pid to check, rather
 * than a name pattern. `exec` replaces the stub's own process image but keeps the same pid, which is
 * what makes the pid captured here the SAME one `Bun.spawn` inside driver.ts holds a handle to.
 * Returns the temp dir (the caller prepends it onto PATH and is responsible for `rmSync`ing it).
 */
export function makeAcpFakeAgentStubDir(
    tmpPrefix: string,
    binaryName: string,
    fakeAgentScript: string,
    pidFile: string,
): string {
    const dir = tempDir(tmpPrefix)
    const stubPath = join(dir, binaryName)
    writeFileSync(
        stubPath,
        `#!/bin/bash\necho $$ > ${JSON.stringify(pidFile)}\nexec bun run ${JSON.stringify(fakeAgentScript)} "$@"\n`,
    )
    chmodSync(stubPath, 0o755)
    return dir
}

/** Poll `pidFile` until it holds a parseable positive integer, or throw after `timeoutMs`. */
export async function waitForPidFile(
    pidFile: string,
    timeoutMs = 5_000,
): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            const n = Number(readFileSync(pidFile, 'utf8').trim())
            if (Number.isFinite(n) && n > 0) return n
        } catch {
            /* not written yet */
        }
        await new Promise(r => setTimeout(r, 50))
    }
    throw new Error(
        `timeout waiting for a fake agent's own pid file at ${pidFile}`,
    )
}

/**
 * Bounded poll for every pid in `pids` to exit — closeChat()'s own kill is fire-and-forget
 * SIGTERM-then-SIGKILL-after-grace, so an IMMEDIATE check would race that escalation — returning the
 * subset that is STILL alive once `timeoutMs` elapses (empty array = clean). Never throws itself: a
 * caller that wants its own teardown (temp-dir `rmSync`, etc.) to run regardless of the outcome should
 * call this, do that cleanup, THEN decide whether to throw — which is why this is split from
 * `assertProcessesGone` below rather than always throwing immediately. Polls every pid concurrently
 * against one shared deadline, so N simultaneously-alive pids cost max(timeoutMs), not N * timeoutMs.
 */
export async function waitProcessesGone(
    pids: number[],
    timeoutMs = 5_000,
): Promise<number[]> {
    const deadline = Date.now() + timeoutMs
    const results = await Promise.all(
        pids.map(async pid => {
            let alive = pidAlive(pid)
            while (alive && Date.now() < deadline) {
                await new Promise(r => setTimeout(r, 100))
                alive = pidAlive(pid)
            }
            return alive ? pid : undefined
        }),
    )
    return results.filter((pid): pid is number => pid !== undefined)
}

/** Convenience wrapper for a test file with no cleanup-ordering concerns of its own: polls (as
 *  `waitProcessesGone` does) and throws immediately if anything survived. Prefer
 *  `waitProcessesGone` directly when temp-dir cleanup must run before the test is allowed to fail. */
export async function assertProcessesGone(
    pids: number[],
    timeoutMs = 5_000,
): Promise<void> {
    const stillAlive = await waitProcessesGone(pids, timeoutMs)
    if (stillAlive.length > 0) {
        throw new Error(
            `fake-agent pid(s) ${stillAlive.join(', ')} still alive ${timeoutMs}ms after teardown — a real leak.`,
        )
    }
}
