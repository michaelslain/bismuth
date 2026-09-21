import { test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    affectedWorkspaces,
    plan,
    sanitizeGitEnv,
    touchesDesignSystem,
    touchesStylesheets,
} from './gate'

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

// --- design-system gate routing ---------------------------------------------------------------

test('touchesDesignSystem fires on app/src changes', () => {
    expect(touchesDesignSystem(['app/src/ui/Text.tsx'])).toBe(true)
    expect(touchesDesignSystem(['app/src/ui/Text.module.css'])).toBe(true)
})

test('touchesDesignSystem fires on the manifest, the baseline and the copied gate scripts', () => {
    expect(touchesDesignSystem(['DESIGN.md'])).toBe(true)
    expect(touchesDesignSystem(['design/baseline.json'])).toBe(true)
    expect(touchesDesignSystem(['design-system.baseline.json'])).toBe(false)
    expect(touchesDesignSystem(['scripts/designSystem/checks.mjs'])).toBe(true)
    expect(touchesDesignSystem(['scripts/designSystem/lib/yamlSubset.mjs'])).toBe(true)
})

test('touchesDesignSystem stays out of the way for everything else', () => {
    expect(touchesDesignSystem(['core/src/server.ts'])).toBe(false)
    expect(touchesDesignSystem(['docs/README.md'])).toBe(false)
    // a workspace name appearing mid-path is not a match — same discipline as affectedWorkspaces
    expect(touchesDesignSystem(['scripts/gate.ts'])).toBe(false)
    expect(touchesDesignSystem(['app/package.json'])).toBe(false)
})

test('a workspace change alone with no design-system trigger still tests only that workspace', () => {
    // DESIGN.md is a root file with no workspace prefix, so affectedWorkspaces alone would miss
    // it entirely -- the gate has to OR the two signals, not just widen affectedWorkspaces.
    expect(affectedWorkspaces(['DESIGN.md'])).toEqual([])
    expect(touchesDesignSystem(['DESIGN.md'])).toBe(true)
})

// --- plan() — what main() actually decides to run, not just the two pure predicates in isolation.
// The two tests above prove affectedWorkspaces/touchesDesignSystem individually; neither one would
// notice main() regressing how it COMBINES them (e.g. the design-system step silently skipping
// tests). Pinning plan()'s output is what makes that a plain assertion instead of something only a
// live `git commit` would surface.

test('plan: a design-system-only change (DESIGN.md) runs the design-system step and skips tests', () => {
    expect(plan(['DESIGN.md'])).toEqual({
        typecheck: false,
        tests: [],
        designSystem: true,
        moduleClassCheck: false,
    })
})

test('plan: a docs-only change runs nothing', () => {
    expect(plan(['docs/x.md'])).toEqual({
        typecheck: false,
        tests: [],
        designSystem: false,
        moduleClassCheck: false,
    })
})

test('plan: an app/src .ts-only change runs typecheck, its workspace tests AND the design-system step, but not moduleClassCheck', () => {
    expect(plan(['app/src/X.tsx'])).toEqual({
        typecheck: true,
        tests: ['app'],
        designSystem: true,
        moduleClassCheck: false,
    })
})

// --- moduleClassCheck routing ------------------------------------------------------------------
// bench/moduleClassCheck.ts builds the app, so it is the slowest gate step (~11s measured) — it
// should fire only on a staged stylesheet, never on a components-only or docs-only change.

test('touchesStylesheets fires on a staged app/src .css or .module.css, not on .ts/.tsx', () => {
    expect(touchesStylesheets(['app/src/ui/Text.module.css'])).toBe(true)
    expect(touchesStylesheets(['app/src/global.css'])).toBe(true)
    expect(touchesStylesheets(['app/src/ui/Text.tsx'])).toBe(false)
    expect(touchesStylesheets(['core/src/server.ts'])).toBe(false)
    expect(touchesStylesheets(['docs/README.md'])).toBe(false)
})

test('plan: a staged .css path enables moduleClassCheck; a .ts-only change does not', () => {
    expect(plan(['app/src/ui/Text.module.css']).moduleClassCheck).toBe(true)
    expect(plan(['app/src/ui/Text.tsx']).moduleClassCheck).toBe(false)
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
