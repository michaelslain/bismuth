import { test, expect } from 'bun:test'
import {
    mkdtempSync,
    mkdirSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync,
    lstatSync,
    readlinkSync,
    symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    ensureBismuthInstalled,
    getBismuthStatus,
    stageSkills,
    linkSkillToClaudeCode,
    isSkillLinkedToClaudeCode,
    claudeMcpAddArgs,
    BISMUTH_HOME,
    SKILL_ID,
    type InstallIO,
} from '../src/bismuthInstall'

// A fully-faked InstallIO so we exercise the version-gated decision logic without touching
// the real filesystem / ~/.claude.json. `calls` records the effectful operations performed.
function fakeIO(
    opts: {
        hash?: string | null
        marker?: string | null
        cli?: boolean
        mcp?: boolean
        skill?: boolean
        registerMcp?: () => Promise<{ ok: boolean; warning?: string }>
    } = {},
): { io: InstallIO; calls: string[] } {
    const calls: string[] = []
    let marker = opts.marker ?? null
    const io: InstallIO = {
        hashSrc: async () => (opts.hash === undefined ? 'HASH1' : opts.hash),
        readMarker: () => marker,
        writeMarker: h => {
            calls.push('writeMarker')
            marker = h
        },
        cliLinked: () => ({
            linked: opts.cli ?? false,
            path: opts.cli ? '/usr/local/bin/bismuth' : null,
        }),
        skillLinked: () => opts.skill ?? false,
        mcpRegistered: async () => opts.mcp ?? false,
        installFiles: () => {
            calls.push('installFiles')
        },
        linkCli: () => {
            calls.push('linkCli')
            return { ok: true, path: '/usr/local/bin/bismuth' }
        },
        linkClaudeSkill: () => {
            calls.push('linkClaudeSkill')
            return { ok: true }
        },
        registerMcp:
            opts.registerMcp ??
            (async () => {
                calls.push('registerMcp')
                return { ok: true }
            }),
    }
    return { io, calls }
}

test('no-ops when already installed and up to date', async () => {
    const { io, calls } = fakeIO({
        hash: 'H',
        marker: 'H',
        cli: true,
        mcp: true,
        skill: true,
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('up-to-date')
    expect(calls).toEqual([]) // zero side effects
})

test('reinstalls when the source hash changed', async () => {
    const { io, calls } = fakeIO({
        hash: 'H2',
        marker: 'H1',
        cli: true,
        mcp: true,
        skill: true,
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('updated')
    expect(calls).toEqual([
        'installFiles',
        'linkCli',
        'linkClaudeSkill',
        'registerMcp',
        'writeMarker',
    ])
})

test('first install when no marker present', async () => {
    const { io } = fakeIO({ hash: 'H', marker: null })
    expect((await ensureBismuthInstalled('/src', io)).action).toBe('installed')
})

test('reinstalls when marker matches but the cli symlink is missing', async () => {
    const { io, calls } = fakeIO({
        hash: 'H',
        marker: 'H',
        cli: false,
        mcp: true,
        skill: true,
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('updated')
    expect(calls).toContain('linkCli')
})

test('reinstalls when marker matches but the Claude Code skill link is missing', async () => {
    const { io, calls } = fakeIO({
        hash: 'H',
        marker: 'H',
        cli: true,
        mcp: true,
        skill: false,
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('updated')
    expect(calls).toContain('linkClaudeSkill')
})

test('skipped when no src or no compiled binaries', async () => {
    expect((await ensureBismuthInstalled(undefined, fakeIO().io)).action).toBe(
        'skipped-no-src',
    )
    expect(
        (await ensureBismuthInstalled('/src', fakeIO({ hash: null }).io))
            .action,
    ).toBe('skipped-no-src')
})

test('dry-run performs no side effects', async () => {
    const { io, calls } = fakeIO({
        hash: 'H2',
        marker: 'H1',
        cli: true,
        mcp: true,
        skill: true,
    })
    const r = await ensureBismuthInstalled('/src', io, { dryRun: true })
    expect(r.action).toBe('would-update')
    expect(calls).toEqual([])
})

test('installs but warns when claude/mcp registration is unavailable', async () => {
    const { io } = fakeIO({
        hash: 'H',
        marker: null,
        registerMcp: async () => ({ ok: false, warning: 'claude not found' }),
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('installed')
    expect(r.warnings).toContain('claude not found')
})

test('getBismuthStatus reflects marker + link + skill + mcp', async () => {
    const s = await getBismuthStatus(
        fakeIO({ marker: 'H', cli: true, mcp: true, skill: true }).io,
    )
    expect(s).toMatchObject({
        installed: true,
        version: 'H',
        cliLinked: true,
        skillLinked: true,
        mcpRegistered: true,
    })
})

// --- Real-fs coverage for the skills-staging + Claude Code exposure behavior ---------------
//
// The InstallIO fakes above never touch a filesystem at all — they just record which methods
// were called. To prove the ACTUAL copy/symlink logic works (not just that ensureBismuthInstalled
// calls the right methods in the right order), the tests below exercise the real, exported
// home-parameterized helpers (stageSkills / linkSkillToClaudeCode / isSkillLinkedToClaudeCode)
// against throwaway mkdtemp directories standing in for ~/.bismuth and ~/.claude — never the
// developer's real home directory. Every temp dir is removed after each test.

function withTempDirs<T>(
    fn: (bismuthHome: string, claudeSkillsDir: string, src: string) => T,
): T {
    const bismuthHome = mkdtempSync(join(tmpdir(), 'bismuth-install-home-'))
    const claudeHome = mkdtempSync(join(tmpdir(), 'bismuth-install-claude-'))
    const claudeSkillsDir = join(claudeHome, 'skills')
    const src = mkdtempSync(join(tmpdir(), 'bismuth-install-src-'))
    try {
        return fn(bismuthHome, claudeSkillsDir, src)
    } finally {
        rmSync(bismuthHome, { recursive: true, force: true })
        rmSync(claudeHome, { recursive: true, force: true })
        rmSync(src, { recursive: true, force: true })
    }
}

function writeFixtureSkill(src: string): void {
    const skillDir = join(src, 'skills', SKILL_ID)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Authoring Bismuth Bases\n')
    mkdirSync(join(skillDir, 'references'), { recursive: true })
    writeFileSync(join(skillDir, 'references', 'table.md'), '# table view\n')
}

// Used by tests that exercise linkSkillToClaudeCode/isSkillLinkedToClaudeCode in isolation —
// writes directly into `<bismuthHome>/skills/<SKILL_ID>` WITHOUT going through stageSkills(), so
// those tests stay independent of stageSkills()'s own correctness (sabotaging stageSkills alone
// must fail only the "skills are staged" test, not this one too).
function seedStagedSkill(bismuthHome: string): void {
    const skillDir = join(bismuthHome, 'skills', SKILL_ID)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Authoring Bismuth Bases\n')
}

test('skills are staged alongside docs (real fs, temp home)', () => {
    withTempDirs((bismuthHome, _claudeSkillsDir, src) => {
        writeFixtureSkill(src)
        stageSkills(src, bismuthHome)
        expect(
            existsSync(join(bismuthHome, 'skills', SKILL_ID, 'SKILL.md')),
        ).toBe(true)
        expect(
            existsSync(
                join(bismuthHome, 'skills', SKILL_ID, 'references', 'table.md'),
            ),
        ).toBe(true)
    })
})

test('the Claude Code skill entry is created as a symlink into the staged skill', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)

        expect(isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            false,
        ) // not linked yet

        const r = linkSkillToClaudeCode(bismuthHome, claudeSkillsDir)
        expect(r.ok).toBe(true)
        expect(r.warning).toBeUndefined()

        const linkPath = join(claudeSkillsDir, SKILL_ID)
        const st = lstatSync(linkPath)
        expect(st.isSymbolicLink()).toBe(true)
        expect(readlinkSync(linkPath)).toBe(
            join(bismuthHome, 'skills', SKILL_ID),
        )
        // Followed through the symlink, the real content is there.
        expect(existsSync(join(linkPath, 'SKILL.md'))).toBe(true)
        expect(isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            true,
        )
    })
})

test('stageSkills against a source tree WITHOUT skills/ warns instead of silently no-opping', () => {
    withTempDirs((bismuthHome, _claudeSkillsDir, src) => {
        // Deliberately do NOT call writeFixtureSkill(src) — src has no skills/ dir at all, the
        // shape of a build (e.g. a forgotten staging step in app/scripts/build-bismuth-tools.ts)
        // that never staged skills into its output.
        const r = stageSkills(src, bismuthHome)
        expect(r.warning).toBeDefined()
        expect(r.warning).toContain('no skills/ found')
        // Non-fatal: no skills dir gets created, but nothing throws and the dest is left clean.
        expect(existsSync(join(bismuthHome, 'skills'))).toBe(false)
    })
})

test('BISMUTH_SKILLS_DIR is set on the registered MCP server spec, pointing at the installed skills path', () => {
    const args = claudeMcpAddArgs()
    const valueIdx = args.findIndex(a => a.startsWith('BISMUTH_SKILLS_DIR='))
    expect(valueIdx).toBeGreaterThan(-1)
    expect(args[valueIdx - 1]).toBe('-e') // it's passed as an `-e KEY=VALUE` flag, like the others
    const value = args[valueIdx].slice('BISMUTH_SKILLS_DIR='.length)
    // Points at the INSTALLED path (~/.bismuth/skills), not a repo-relative one — a machine-wide
    // install has no repo root, which is exactly why this env var exists.
    expect(value).toBe(join(BISMUTH_HOME, 'skills'))
})

test('a pre-existing non-Bismuth Claude Code skill entry is not overwritten and produces a warning', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)

        // Simulate a foreign entry: a REAL directory (not our symlink) already at the target path.
        mkdirSync(claudeSkillsDir, { recursive: true })
        const foreignPath = join(claudeSkillsDir, SKILL_ID)
        mkdirSync(foreignPath, { recursive: true })
        writeFileSync(join(foreignPath, 'SKILL.md'), "# Someone else's skill\n")

        const r = linkSkillToClaudeCode(bismuthHome, claudeSkillsDir)
        expect(r.ok).toBe(false)
        expect(r.warning).toBeDefined()
        expect(r.warning).toContain('already exists')
        expect(r.warning).toContain("wasn't created by Bismuth")

        // Untouched — still the foreign directory with its own content, not our symlink.
        const st = lstatSync(foreignPath)
        expect(st.isSymbolicLink()).toBe(false)
        expect(existsSync(join(foreignPath, 'SKILL.md'))).toBe(true)
        expect(readFileSync(join(foreignPath, 'SKILL.md'), 'utf8')).toBe(
            "# Someone else's skill\n",
        )
        expect(isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            false,
        )
    })
})

test('a foreign symlink pointing elsewhere is also treated as not ours and left alone', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)

        // A symlink that exists but points OUTSIDE bismuthHome — not ours, even though it's a symlink.
        mkdirSync(claudeSkillsDir, { recursive: true })
        const elsewhere = mkdtempSync(
            join(tmpdir(), 'bismuth-install-elsewhere-'),
        )
        try {
            symlinkSync(elsewhere, join(claudeSkillsDir, SKILL_ID))
            const r = linkSkillToClaudeCode(bismuthHome, claudeSkillsDir)
            expect(r.ok).toBe(false)
            expect(r.warning).toContain("wasn't created by Bismuth")
            expect(readlinkSync(join(claudeSkillsDir, SKILL_ID))).toBe(
                elsewhere,
            )
        } finally {
            rmSync(elsewhere, { recursive: true, force: true })
        }
    })
})
