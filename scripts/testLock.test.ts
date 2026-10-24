// The machine-wide test lock (scripts/testLock.ts): where it lives and whose it is.
import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { lockPath, ownerPid } from './testLock'

test('ownerPid reads the pid a gate writes, and none from a hand-made owner line', () => {
    expect(ownerPid('gate pid=4242 since 13:02:11 /repo')).toBe(4242)
    expect(ownerPid('main merger row 4 13:02:11')).toBeUndefined()
    expect(ownerPid('')).toBeUndefined()
})

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
