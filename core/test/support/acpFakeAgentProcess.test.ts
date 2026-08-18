// Exercises waitProcessesGone/assertProcessesGone directly against REAL child processes (never a
// pgrep-style mock) — the two properties every fakeAcpAgent.ts-driven test file's afterEach depends
// on: (1) a process that survives its signal is still reported/thrown as a leak, and (2) multiple
// simultaneously-alive pids are waited on concurrently, not summed.
import { describe, expect, test } from 'bun:test'
import {
    assertProcessesGone,
    pidAlive,
    waitProcessesGone,
} from './acpFakeAgentProcess'

/** A real child that traps and ignores SIGTERM, so a caller's kill() cannot make it exit — the same
 *  shape a hung fake-agent process takes against closeChat()'s fire-and-forget signal. Waits for the
 *  child's own "ready" echo (printed only after the trap is installed) before returning, so a kill()
 *  sent immediately after can never race bash's default TERM disposition during startup. */
async function spawnSigtermIgnoring(): Promise<ReturnType<typeof Bun.spawn>> {
    const proc = Bun.spawn(
        ['bash', '-c', 'trap "" TERM; echo ready; sleep 30'],
        { stdout: 'pipe', stderr: 'ignore' },
    )
    const reader = proc.stdout.getReader()
    await reader.read()
    reader.releaseLock()
    return proc
}

async function killAndReap(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
    try {
        proc.kill('SIGKILL')
    } catch {
        /* already exited */
    }
    await proc.exited
}

describe('waitProcessesGone / assertProcessesGone', () => {
    test('a pid that ignores SIGTERM is still reported alive, and assertProcessesGone still throws', async () => {
        const proc = await spawnSigtermIgnoring()
        try {
            expect(pidAlive(proc.pid)).toBe(true)
            proc.kill('SIGTERM')
            const stillAlive = await waitProcessesGone([proc.pid], 300)
            expect(stillAlive).toEqual([proc.pid])
            await expect(assertProcessesGone([proc.pid], 300)).rejects.toThrow(
                /still alive/,
            )
        } finally {
            await killAndReap(proc)
        }
    })

    test('waits on multiple survivors concurrently, bounded by one timeout budget rather than their sum', async () => {
        const timeoutMs = 1_000
        const procs = await Promise.all([
            spawnSigtermIgnoring(),
            spawnSigtermIgnoring(),
            spawnSigtermIgnoring(),
        ])
        try {
            const pids = procs.map(p => p.pid)
            for (const p of procs) p.kill('SIGTERM')

            const start = Date.now()
            const stillAlive = await waitProcessesGone(pids, timeoutMs)
            const elapsedMs = Date.now() - start

            expect(stillAlive.slice().sort()).toEqual(pids.slice().sort())
            // A sequential wait (one timeoutMs budget per pid) could never finish before 3 * timeoutMs =
            // 3000ms here, since every pid stays alive for the full budget. A concurrent wait finishes
            // close to one timeoutMs. 2000ms sits with ~1s of margin on both sides of that gap.
            expect(elapsedMs).toBeLessThan(2_000)
        } finally {
            await Promise.all(procs.map(killAndReap))
        }
    }, 10_000)
})
