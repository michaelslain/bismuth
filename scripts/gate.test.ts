import { test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { affectedWorkspaces, sanitizeGitEnv } from './gate'

test('a single-workspace edit tests only that workspace', () => {
    expect(affectedWorkspaces(['app/src/App.tsx'])).toEqual(['app'])
    expect(
        affectedWorkspaces(['core/src/server.ts', 'core/test/server.test.ts']),
    ).toEqual(['core'])
})

test('edits across workspaces test each of them, in a stable order', () => {
    expect(affectedWorkspaces(['daemon/src/x.ts', 'app/src/y.ts'])).toEqual([
        'app',
        'daemon',
    ])
})

test('a shared root file widens the gate to every workspace', () => {
    // These can change resolution/config for everything, so a narrow gate would be false comfort.
    for (const f of [
        'package.json',
        'bun.lock',
        'tsconfig.base.json',
        'bunfig.toml',
        'scripts/gate.ts',
    ]) {
        expect(affectedWorkspaces([f])).toEqual([
            'core',
            'app',
            'cli',
            'mcp',
            'relay',
            'memory',
            'daemon',
        ])
    }
})

test('docs-only and asset-only changes touch no workspace, so the gate stays out of the way', () => {
    expect(
        affectedWorkspaces([
            'docs/README.md',
            'CLAUDE.md',
            '.gitignore',
            'design/x.png',
        ]),
    ).toEqual([])
})

test('a workspace name appearing mid-path does not count as that workspace', () => {
    // "docs/core/x.md" is docs, not core — the match is anchored to the path's first segment.
    expect(affectedWorkspaces(['docs/core/x.md'])).toEqual([])
})

test('nothing staged yields nothing to test', () => {
    expect(affectedWorkspaces([])).toEqual([])
})

// --- git hook-environment isolation ---------------------------------------------------------
// The gate runs INSIDE a git hook, so git has injected its repo-location vars into the
// environment. Test suites this gate spawns shell out to git against throwaway dirs
// (core/src/backup.ts git-inits and commits temp vaults). If those vars are inherited, the
// nested calls operate on THIS repo instead of the temp dir — `git -C` does not save you.

test('sanitizeGitEnv drops every repo-location var and keeps everything else', () => {
    const clean = sanitizeGitEnv({
        PATH: '/usr/bin',
        HOME: '/Users/x',
        GIT_EXEC_PATH: '/usr/libexec/git-core', // behaviour, not target — must survive
        GIT_DIR: '/repo/.git',
        GIT_WORK_TREE: '/repo',
        GIT_INDEX_FILE: '/repo/.git/index',
        GIT_PREFIX: '',
        GIT_COMMON_DIR: '/repo/.git',
        GIT_NAMESPACE: 'ns',
        GIT_OBJECT_DIRECTORY: '/repo/.git/objects',
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '/other/objects',
    })
    expect(clean.PATH).toBe('/usr/bin')
    expect(clean.HOME).toBe('/Users/x')
    expect(clean.GIT_EXEC_PATH).toBe('/usr/libexec/git-core')
    for (const k of [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_PREFIX',
        'GIT_COMMON_DIR',
        'GIT_NAMESPACE',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    ]) {
        expect(clean).not.toHaveProperty(k)
    }
})

// Behavioural, not structural: this asserts on what git ACTUALLY writes. The first half proves the
// hazard is real (so the second half isn't guarding a phantom); the second proves the fix stops it.
test("a leaked GIT_DIR makes a nested `git -C <other>` write THIS repo's index — sanitizing stops it", () => {
    const git = (
        args: string[],
        cwd: string,
        env: Record<string, string | undefined>,
    ) =>
        spawnSync('git', args, {
            cwd,
            encoding: 'utf8',
            env: env as NodeJS.ProcessEnv,
        })

    // A stand-in for the real repo, with one committed file.
    const victim = mkdtempSync(join(tmpdir(), 'gate-victim-'))
    writeFileSync(join(victim, 'tracked.txt'), 'original\n')
    for (const a of [
        ['init', '-q'],
        ['add', '-A'],
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'],
    ]) {
        git(a, victim, process.env)
    }
    const victimIndex = () =>
        git(['ls-files'], victim, process.env)
            .stdout.trim()
            .split('\n')
            .filter(Boolean)
    expect(victimIndex()).toEqual(['tracked.txt'])

    // A stand-in for a test's throwaway vault, holding a file the real repo has never seen.
    const vault = mkdtempSync(join(tmpdir(), 'gate-vault-'))
    writeFileSync(join(vault, 'ONLY-IN-VAULT.md'), 'note\n')

    const leaked = {
        ...process.env,
        GIT_DIR: join(victim, '.git'),
        GIT_WORK_TREE: vault,
    }

    // 1. The hazard is real: with the vars leaked, adding in `vault` stages into VICTIM's index.
    git(['-C', vault, 'add', '-A'], vault, leaked)
    expect(victimIndex()).toContain('ONLY-IN-VAULT.md')

    // Reset victim's index back to its committed state before testing the fix.
    git(['reset', '-q'], victim, process.env)
    expect(victimIndex()).toEqual(['tracked.txt'])

    // 2. The fix: same call, environment sanitized — victim's index is untouched.
    git(['-C', vault, 'add', '-A'], vault, sanitizeGitEnv(leaked))
    expect(victimIndex()).toEqual(['tracked.txt'])
})
