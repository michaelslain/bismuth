// scripts/testLock.ts
//
// One test run at a time on this machine. Parallel suites from several checkouts keep macOS
// `fseventsd` busy and make the vault-watcher tests time out, so every gate and `test:fast` run
// takes this lock first and waits while another run holds it. The lock is a directory,
// `<main checkout>/.claude/coord/test.lock`, shared by every worktree of the repo; `mkdir` is the
// atomic test-and-set. Its `owner` file names the holder:
//
//   gate pid=4242 since 13:02:11 /Users/m/Documents/dev/bismuth/.claude/worktrees/x
//
// A lock whose `pid=` process is gone is stale and is taken over. A hand-made lock (a session's
// `mkdir` with a free-text owner line and no pid) is waited on until it is removed, or until it is
// HAND_LOCK_STALE_MS old, since nothing else can tell that its session ended.
//
// A child of the holder inherits BISMUTH_TEST_LOCK_HELD and does not take the lock again. A session
// that made the lock by hand sets BISMUTH_TEST_LOCK_HELD=1 for the runs inside it.
import { spawnSync } from 'node:child_process'
import {
    mkdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

const HELD_ENV = 'BISMUTH_TEST_LOCK_HELD'
const POLL_MS = 2000
const REPORT_MS = 30_000
const HAND_LOCK_STALE_MS = 60 * 60_000

/** The lock directory for the repo containing `cwd`: under the MAIN checkout, so all worktrees share it. */
export function lockPath(cwd = process.cwd()): string {
    const r = spawnSync('git', ['rev-parse', '--git-common-dir'], {
        cwd,
        encoding: 'utf8',
    })
    const common = r.status === 0 ? r.stdout.trim() : join(cwd, '.git')
    const abs = isAbsolute(common) ? common : resolve(cwd, common)
    return join(dirname(abs), '.claude', 'coord', 'test.lock')
}

/** The holder's pid from an owner line, or undefined for a hand-made lock. */
export function ownerPid(owner: string): number | undefined {
    const m = owner.match(/\bpid=(\d+)\b/)
    return m ? Number(m[1]) : undefined
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (e) {
        return (e as NodeJS.ErrnoException).code === 'EPERM'
    }
}

function readOwner(dir: string): string {
    try {
        return readFileSync(join(dir, 'owner'), 'utf8').trim()
    } catch {
        return ''
    }
}

const sleep = (ms: number) => Bun.sleepSync(ms)

function lockAge(dir: string): number {
    try {
        return Date.now() - statSync(dir).mtimeMs
    } catch {
        return 0
    }
}

/**
 * Take the lock, waiting while another live run holds it. Returns a release function. Re-entrant:
 * inside a holder (BISMUTH_TEST_LOCK_HELD set) it returns a no-op. Sets BISMUTH_TEST_LOCK_HELD in
 * this process so spawned children inherit it.
 */
export function acquireTestLock(label: string): () => void {
    if (process.env[HELD_ENV]) return () => {}
    const dir = lockPath()
    mkdirSync(dirname(dir), { recursive: true })
    const started = Date.now()
    let lastReport = 0
    for (;;) {
        try {
            mkdirSync(dir)
            break
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
        const owner = readOwner(dir)
        const pid = ownerPid(owner)
        if (
            (pid !== undefined && !alive(pid)) ||
            (pid === undefined && lockAge(dir) > HAND_LOCK_STALE_MS)
        ) {
            process.stdout.write(
                `\x1b[2m[test lock] taking over a stale lock (${owner || 'no owner file'})\x1b[0m\n`,
            )
            rmSync(dir, { recursive: true, force: true })
            continue
        }
        if (Date.now() - lastReport >= REPORT_MS) {
            const waited = Math.round((Date.now() - started) / 1000)
            process.stdout.write(
                `\x1b[2m[test lock] waiting ${waited}s for: ${owner || '(no owner file)'}${pid === undefined ? ` (a hand-made lock: if this session made it, rerun with ${HELD_ENV}=1)` : ''}\x1b[0m\n`,
            )
            lastReport = Date.now()
        }
        sleep(POLL_MS)
    }
    const time = new Date().toTimeString().slice(0, 8)
    writeFileSync(
        join(dir, 'owner'),
        `${label} pid=${process.pid} since ${time} ${process.cwd()}\n`,
    )
    process.env[HELD_ENV] = dir
    let released = false
    const release = () => {
        if (released) return
        released = true
        delete process.env[HELD_ENV]
        if (ownerPid(readOwner(dir)) === process.pid)
            rmSync(dir, { recursive: true, force: true })
    }
    process.on('exit', release)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
        process.once(sig, () => {
            release()
            process.exit(130)
        })
    return release
}
