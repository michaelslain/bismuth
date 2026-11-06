// The machine-wide test lock (scripts/testLock.ts): where it lives and whose it is.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    historyPath,
    lockPath,
    ownerAt,
    ownerPid,
    trimHistory,
    waiters,
    waitingPath,
} from './testLock'

test('ownerPid reads the pid a gate writes, and none from a hand-made owner line', () => {
    expect(ownerPid('gate pid=4242 since 13:02:11 /repo')).toBe(4242)
    expect(ownerPid('main merger row 4 13:02:11')).toBeUndefined()
    expect(ownerPid('')).toBeUndefined()
})

test('ownerAt reads when the lock was taken, and nothing from an owner line without it', () => {
    expect(ownerAt('gate pid=4242 since 13:02:11 at=1793000531000 /repo')).toBe(
        1793000531000,
    )
    expect(ownerAt('gate pid=4242 since 13:02:11 /repo')).toBeUndefined()
})

test('trimHistory keeps the last lines once the history doubles past the limit', () => {
    const lines = (n: number) =>
        Array.from({ length: n }, (_, i) => `{"i":${i}}`).join('\n') + '\n'
    expect(trimHistory(lines(6), 3)).toBe(lines(6))
    expect(trimHistory(lines(7), 3)).toBe('{"i":4}\n{"i":5}\n{"i":6}\n')
})

test('waiters lists live waiting runs oldest first and skips dead pids', () => {
    const lock = join(
        realpathSync(mkdtempSync(join(tmpdir(), 'bismuth-lock-'))),
        'test.lock',
    )
    mkdirSync(waitingPath(lock), { recursive: true })
    const dead = spawnSync('true').pid
    writeFileSync(
        join(waitingPath(lock), String(process.pid)),
        `b pid=${process.pid} at=200 /x\n`,
    )
    writeFileSync(
        join(waitingPath(lock), String(process.ppid)),
        `a pid=${process.ppid} at=100 /y\n`,
    )
    writeFileSync(
        join(waitingPath(lock), String(dead)),
        `c pid=${dead} at=50 /z\n`,
    )
    expect(waiters(lock)).toEqual([
        `a pid=${process.ppid} at=100 /y`,
        `b pid=${process.pid} at=200 /x`,
    ])
})

test('a run that waited takes the lock, clears its waiter file and records the hold on release', async () => {
    const lock = join(
        realpathSync(mkdtempSync(join(tmpdir(), 'bismuth-lock-'))),
        'test.lock',
    )
    // Held by this live process, so the child has to wait until it is removed.
    mkdirSync(lock)
    writeFileSync(
        join(lock, 'owner'),
        `t pid=${process.pid} since 00:00:00 /t\n`,
    )
    const env = { ...process.env }
    delete env.BISMUTH_TEST_LOCK_HELD
    const child = Bun.spawn(
        [
            process.execPath,
            '-e',
            `const { acquireTestLock } = await import(${JSON.stringify(join(import.meta.dir, 'testLock.ts'))})
             acquireTestLock('probe', ${JSON.stringify(lock)})()`,
        ],
        { env, stdout: 'ignore', stderr: 'pipe' },
    )
    const waitFile = join(waitingPath(lock), String(child.pid))
    for (let i = 0; i < 100 && !existsSync(waitFile); i++) Bun.sleepSync(50)
    expect(readFileSync(waitFile, 'utf8')).toContain(
        `probe pid=${child.pid} at=`,
    )
    Bun.spawnSync(['rm', '-rf', lock])
    const code = await child.exited
    expect(code).toBe(0)
    expect(existsSync(waitFile)).toBe(false)
    expect(existsSync(lock)).toBe(false)
    const rec = JSON.parse(readFileSync(historyPath(lock), 'utf8').trim())
    expect(rec.label).toBe('probe')
    expect(rec.heldMs).toBe(rec.releasedAt - rec.acquiredAt)
    expect(rec.waitedMs).toBeGreaterThan(0)
}, 15_000)

test('every worktree of a repo shares the lock under the main checkout', () => {
    const main = realpathSync(mkdtempSync(join(tmpdir(), 'bismuth-lock-')))
    const git = (args: string[], cwd: string) =>
        spawnSync('git', args, { cwd, encoding: 'utf8' })
    git(['init', '-q'], main)
    git(
        [
            '-c',
            'user.email=t@t',
            '-c',
            'user.name=t',
            'commit',
            '-q',
            '--allow-empty',
            '-m',
            'x',
        ],
        main,
    )
    const wt = join(main, '.claude', 'worktrees', 'w')
    mkdirSync(join(main, '.claude', 'worktrees'), { recursive: true })
    git(['worktree', 'add', '-q', '--detach', wt], main)
    const expected = join(main, '.claude', 'coord', 'test.lock')
    expect(lockPath(main)).toBe(expected)
    expect(lockPath(wt)).toBe(expected)
})
