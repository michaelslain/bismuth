// scripts/testLock.ts
//
// One test run at a time on this machine. Parallel suites from several checkouts keep macOS
// `fseventsd` busy and make the vault-watcher tests time out, so every gate and `test:fast` run
// takes this lock first and waits while another run holds it. The lock is a directory,
// `<main checkout>/.claude/coord/test.lock`, shared by every worktree of the repo; `mkdir` is the
// atomic test-and-set. Its `owner` file names the holder:
//
//   gate pid=4242 since 13:02:11 at=1793000531000 /Users/m/Documents/dev/bismuth/.claude/worktrees/x
//
// `at=` is the epoch milliseconds the lock was taken. A run waiting for the lock leaves a file
// `test.lock.waiting/<pid>` beside it (`<label> pid=<pid> at=<ms since waiting> <cwd>`), removed once
// it takes the lock or exits. Each release appends one JSON line to `test-lock-history.jsonl` in the
// same folder: label, cwd, when the lock was taken and released, and how long it was held and
// waited for. Together they let a tool (the main-merger skill's merge queue) estimate when the lock
// frees up.
//
// A lock whose `pid=` process is gone is stale and is taken over. A hand-made lock (a session's
// `mkdir` with a free-text owner line and no pid) is waited on until it is removed, or until it is
// HAND_LOCK_STALE_MS old, since nothing else can tell that its session ended.
//
// A child of the holder inherits BISMUTH_TEST_LOCK_HELD and does not take the lock again. A session
// that made the lock by hand sets BISMUTH_TEST_LOCK_HELD=1 for the runs inside it.
import { spawnSync } from 'node:child_process'
import {
    appendFileSync,
    mkdirSync,
    readdirSync,
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
/** History lines kept: trimmed back to HISTORY_KEEP once it passes twice that. */
const HISTORY_KEEP = 500

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

/** When the holder took the lock (epoch ms), or undefined for an owner line without `at=`. */
export function ownerAt(owner: string): number | undefined {
    const m = owner.match(/\bat=(\d+)\b/)
    return m ? Number(m[1]) : undefined
}

/** The folder of waiter files beside a lock directory. */
export function waitingPath(lock: string): string {
    return `${lock}.waiting`
}

/** The release history beside a lock directory. */
export function historyPath(lock: string): string {
    return join(dirname(lock), 'test-lock-history.jsonl')
}

export type LockRelease = {
    label: string
    cwd: string
    acquiredAt: number
    releasedAt: number
    heldMs: number
    waitedMs: number
}

/** `text` with only its last `keep` lines once it holds more than twice that many. Pure. */
export function trimHistory(text: string, keep = HISTORY_KEEP): string {
    const lines = text.split('\n').filter(Boolean)
    if (lines.length <= keep * 2) return text
    return lines.slice(-keep).join('\n') + '\n'
}

function appendHistory(lock: string, rec: LockRelease): void {
    const file = historyPath(lock)
    try {
        appendFileSync(file, JSON.stringify(rec) + '\n')
        const text = readFileSync(file, 'utf8')
        const trimmed = trimHistory(text)
        if (trimmed !== text) writeFileSync(file, trimmed)
    } catch {
        // History feeds estimates only; a failed write never fails the run.
    }
}

/** The live runs waiting for a lock: their owner-style lines, oldest first. */
export function waiters(lock: string): string[] {
    const dir = waitingPath(lock)
    let names: string[] = []
    try {
        names = readdirSync(dir)
    } catch {
        return []
    }
    const live: { line: string; at: number }[] = []
    for (const name of names) {
        const pid = Number(name)
        if (!Number.isInteger(pid) || !alive(pid)) continue
        try {
            const line = readFileSync(join(dir, name), 'utf8').trim()
            live.push({ line, at: ownerAt(line) ?? 0 })
        } catch {
            // Removed between the listing and the read: it took the lock.
        }
    }
    return live.sort((a, b) => a.at - b.at).map(w => w.line)
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
export function acquireTestLock(label: string, dir = lockPath()): () => void {
    if (process.env[HELD_ENV]) return () => {}
    mkdirSync(dirname(dir), { recursive: true })
    const started = Date.now()
    const waitFile = join(waitingPath(dir), String(process.pid))
    const unwait = () => rmSync(waitFile, { force: true })
    let waiting = false
    let lastReport = 0
    for (;;) {
        try {
            mkdirSync(dir)
            break
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
        }
        if (!waiting) {
            waiting = true
            mkdirSync(waitingPath(dir), { recursive: true })
            writeFileSync(
                waitFile,
                `${label} pid=${process.pid} at=${started} ${process.cwd()}\n`,
            )
            process.on('exit', unwait)
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
    if (waiting) {
        unwait()
        process.off('exit', unwait)
    }
    const acquiredAt = Date.now()
    const time = new Date(acquiredAt).toTimeString().slice(0, 8)
    writeFileSync(
        join(dir, 'owner'),
        `${label} pid=${process.pid} since ${time} at=${acquiredAt} ${process.cwd()}\n`,
    )
    process.env[HELD_ENV] = dir
    let released = false
    const release = () => {
        if (released) return
        released = true
        delete process.env[HELD_ENV]
        if (ownerPid(readOwner(dir)) !== process.pid) return
        rmSync(dir, { recursive: true, force: true })
        const releasedAt = Date.now()
        appendHistory(dir, {
            label,
            cwd: process.cwd(),
            acquiredAt,
            releasedAt,
            heldMs: releasedAt - acquiredAt,
            waitedMs: acquiredAt - started,
        })
    }
    process.on('exit', release)
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
        process.once(sig, () => {
            release()
            process.exit(130)
        })
    return release
}
