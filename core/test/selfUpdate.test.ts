import { test, expect } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    getUpdateProgress,
    getUpdateStatus,
    runPipeline,
    type GitRunner,
    type ProcRunner,
} from '../src/selfUpdate'

// A fake git runner: maps a subcommand key → canned {code, stdout}. rev-parse is keyed by
// its target ("rev-parse HEAD" / "rev-parse origin/main" / "rev-parse --is-inside-work-tree").
function fakeGit(
    map: Record<string, { code?: number; stdout?: string; stderr?: string }>,
): GitRunner {
    return async (_repo, args) => {
        const key = args[0] === 'rev-parse' ? `rev-parse ${args[1]}` : args[0]
        const r = map[key] ?? { code: 0, stdout: '' }
        return {
            code: r.code ?? 0,
            stdout: r.stdout ?? '',
            stderr: r.stderr ?? '',
        }
    }
}

const ORIGIN = { repoRoot: '/repo', sha: 'aaaa' }

test("not-a-source-build when there's no build origin", async () => {
    const s = await getUpdateStatus({ origin: null, git: fakeGit({}) })
    expect(s.available).toBe(false)
    expect(s.reason).toBe('not-a-source-build')
})

test("not-a-git-repo when the repo isn't a work tree", async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({ 'rev-parse --is-inside-work-tree': { code: 1 } }),
    })
    expect(s.reason).toBe('not-a-git-repo')
    expect(s.builtSha).toBe('aaaa')
})

test("access-denied when git can't read the build-source repo (macOS TCC)", async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': {
                code: 128,
                stderr: "fatal: cannot change to '/repo': Operation not permitted",
            },
        }),
    })
    expect(s.available).toBe(false)
    expect(s.reason).toBe('access-denied')
})

test('repo-missing when the build-source repo no longer exists', async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': {
                code: 128,
                stderr: "fatal: cannot change to '/repo': No such file or directory",
            },
        }),
    })
    expect(s.reason).toBe('repo-missing')
})

test("git-not-found when the git binary can't be spawned", async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': {
                code: -1,
                stderr: 'spawn git ENOENT',
            },
        }),
    })
    expect(s.reason).toBe('git-not-found')
})

test('no-upstream when origin/main is missing', async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true' },
            'rev-parse origin/main': { code: 1 },
        }),
    })
    expect(s.reason).toBe('no-upstream')
})

test('available when behind > 0', async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true' },
            'rev-parse origin/main': { code: 0, stdout: 'bbbb' },
            'rev-parse HEAD': { code: 0, stdout: 'aaaa' },
            'rev-list': { code: 0, stdout: '3' },
            status: { code: 0, stdout: '' },
        }),
    })
    expect(s).toMatchObject({
        available: true,
        behind: 3,
        localSha: 'aaaa',
        remoteSha: 'bbbb',
        dirty: false,
    })
})

test("behind is measured from builtSha, not the clone's HEAD", async () => {
    // The build-source clone has advanced its HEAD to origin/main (developer committed +
    // pushed from it), but the installed app is still at builtSha 'aaaa'. HEAD..origin/main
    // would be 0; builtSha..origin/main is 2 — and the latter is what must drive the banner.
    const git: GitRunner = async (_repo, args) => {
        if (args[0] === 'rev-parse') {
            const target = args[1]
            if (target === '--is-inside-work-tree')
                return { code: 0, stdout: 'true', stderr: '' }
            if (target === 'origin/main')
                return { code: 0, stdout: 'bbbb', stderr: '' }
            if (target === 'HEAD')
                return { code: 0, stdout: 'bbbb', stderr: '' } // clone == origin/main
            return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'rev-list') {
            const range = args[2]
            if (range === 'aaaa..origin/main')
                return { code: 0, stdout: '2', stderr: '' }
            if (range === 'HEAD..origin/main')
                return { code: 0, stdout: '0', stderr: '' }
            return { code: 0, stdout: '0', stderr: '' }
        }
        if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
    }
    const s = await getUpdateStatus({
        origin: { repoRoot: '/repo', sha: 'aaaa' },
        git,
    })
    expect(s).toMatchObject({
        available: true,
        behind: 2,
        builtSha: 'aaaa',
        localSha: 'bbbb',
        remoteSha: 'bbbb',
    })
})

test('falls back to HEAD-based count when builtSha is unresolvable', async () => {
    // builtSha 'aaaa' isn't in this clone (shallow/GC'd) → its rev-list errors; we fall back
    // to HEAD..origin/main rather than reporting 0.
    const git: GitRunner = async (_repo, args) => {
        if (args[0] === 'rev-parse') {
            const target = args[1]
            if (target === '--is-inside-work-tree')
                return { code: 0, stdout: 'true', stderr: '' }
            if (target === 'origin/main')
                return { code: 0, stdout: 'bbbb', stderr: '' }
            if (target === 'HEAD')
                return { code: 0, stdout: 'cccc', stderr: '' }
            return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'rev-list') {
            const range = args[2]
            if (range === 'aaaa..origin/main')
                return { code: 128, stdout: '', stderr: 'bad revision' }
            if (range === 'HEAD..origin/main')
                return { code: 0, stdout: '5', stderr: '' }
            return { code: 0, stdout: '0', stderr: '' }
        }
        if (args[0] === 'status') return { code: 0, stdout: '', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
    }
    const s = await getUpdateStatus({
        origin: { repoRoot: '/repo', sha: 'aaaa' },
        git,
    })
    expect(s).toMatchObject({ available: true, behind: 5, builtSha: 'aaaa' })
})

test('not available when up to date; dirty flag surfaces', async () => {
    const s = await getUpdateStatus({
        origin: ORIGIN,
        git: fakeGit({
            'rev-parse --is-inside-work-tree': { code: 0, stdout: 'true' },
            'rev-parse origin/main': { code: 0, stdout: 'aaaa' },
            'rev-parse HEAD': { code: 0, stdout: 'aaaa' },
            'rev-list': { code: 0, stdout: '0' },
            status: { code: 0, stdout: ' M core/src/x.ts' },
        }),
    })
    expect(s.available).toBe(false)
    expect(s.behind).toBe(0)
    expect(s.dirty).toBe(true)
})

function testLogPath(name: string): string {
    return join(tmpdir(), `bismuth-update-build-test-${name}-${process.pid}.log`)
}

test('runPipeline runs pull, install, then build, in order', async () => {
    const calls: string[] = []
    const git: GitRunner = async (_repo, args) => {
        calls.push(`git ${args.join(' ')}`)
        return { code: 0, stdout: '', stderr: '' }
    }
    const seenProc: { cmd: string[]; cwd?: string }[] = []
    const proc: ProcRunner = async (cmd, opts) => {
        calls.push(cmd.join(' '))
        seenProc.push({ cmd, cwd: opts?.cwd })
        return { code: 0, stdout: '', stderr: '' }
    }
    let relaunched = false
    await runPipeline('/repo', '/Applications/Bismuth.app', {
        git,
        proc,
        signingIdentity: async () => null,
        spawnRelauncher: () => {
            relaunched = true
        },
        logPath: testLogPath('order'),
    })
    expect(calls[0]).toBe('git pull --ff-only origin main')
    expect(calls[1]).toContain('install --frozen-lockfile')
    expect(calls[2]).toContain('run tauri build --bundles app')
    expect(seenProc[0].cwd).toBe('/repo')
    expect(seenProc[0].cmd).toContain('install')
    expect(seenProc[0].cmd).toContain('--frozen-lockfile')
    expect(seenProc[1].cwd).toBe(join('/repo', 'app'))
    expect(relaunched).toBe(true)
})

test('install failure stops before the build and reports the log path', async () => {
    const git: GitRunner = async () => ({ code: 0, stdout: '', stderr: '' })
    const buildCalls: string[][] = []
    const proc: ProcRunner = async cmd => {
        if (cmd.includes('install'))
            return { code: 1, stdout: '', stderr: 'Could not resolve: "heic-convert"' }
        buildCalls.push(cmd)
        return { code: 0, stdout: '', stderr: '' }
    }
    const logPath = testLogPath('install-fail')
    let relaunched = false
    await runPipeline('/repo', '/Applications/Bismuth.app', {
        git,
        proc,
        signingIdentity: async () => null,
        spawnRelauncher: () => {
            relaunched = true
        },
        logPath,
    })
    expect(buildCalls).toEqual([])
    expect(relaunched).toBe(false)
    const progress = getUpdateProgress()
    expect(progress.phase).toBe('error')
    expect(progress.message).toContain('bun install failed')
    expect(progress.message).toContain(logPath)
})

test('pull failure never runs install', async () => {
    const git: GitRunner = async () => ({
        code: 1,
        stdout: '',
        stderr: 'diverged',
    })
    const procCalls: string[][] = []
    const proc: ProcRunner = async cmd => {
        procCalls.push(cmd)
        return { code: 0, stdout: '', stderr: '' }
    }
    await runPipeline('/repo', '/Applications/Bismuth.app', {
        git,
        proc,
        signingIdentity: async () => null,
        spawnRelauncher: () => {},
        logPath: testLogPath('pull-fail'),
    })
    expect(procCalls).toEqual([])
    expect(getUpdateProgress().phase).toBe('error')
    expect(getUpdateProgress().message).toContain('git pull failed')
})
