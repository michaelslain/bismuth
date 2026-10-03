import { tempDir } from './helpers'
import { test, expect } from 'bun:test'
import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    rmSync,
    existsSync,
    lstatSync,
    readlinkSync,
    symlinkSync,
} from 'node:fs'
import { join } from 'node:path'
import {
    ensureBismuthInstalled,
    getBismuthStatus,
    stageSkills,
    linkSkillToClaudeCode,
    linkAllSkillsToClaudeCode,
    isSkillLinkedToClaudeCode,
    areSkillsLinkedToClaudeCode,
    claudeMcpAddArgs,
    BISMUTH_HOME,
    SKILL_IDS,
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
            return { ok: true, warnings: [] }
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

test('a status with only the bases link present is not up-to-date and re-runs linkClaudeSkill', async () => {
    // The fake's skillLinked() is the all-linked boolean; a machine upgraded from the one-skill
    // build has the bases link only, so it reads false and the ensure must relink everything.
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

test('every warning from linkClaudeSkill is surfaced on the result', async () => {
    const { io } = fakeIO({ hash: 'H', marker: null })
    io.linkClaudeSkill = () => ({ ok: false, warnings: ['w-one', 'w-two'] })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.warnings).toEqual(expect.arrayContaining(['w-one', 'w-two']))
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
    const bismuthHome = tempDir('bismuth-install-home-')
    const claudeHome = tempDir('bismuth-install-claude-')
    const claudeSkillsDir = join(claudeHome, 'skills')
    const src = tempDir('bismuth-install-src-')
    try {
        return fn(bismuthHome, claudeSkillsDir, src)
    } finally {
        rmSync(bismuthHome, { recursive: true, force: true })
        rmSync(claudeHome, { recursive: true, force: true })
        rmSync(src, { recursive: true, force: true })
    }
}

function writeFixtureSkill(src: string): void {
    for (const id of SKILL_IDS) {
        const skillDir = join(src, 'skills', id)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), `# ${id}\n`)
        mkdirSync(join(skillDir, 'references'), { recursive: true })
        writeFileSync(join(skillDir, 'references', 'table.md'), '# table view\n')
    }
}

// Used by tests that exercise linkSkillToClaudeCode/isSkillLinkedToClaudeCode in isolation —
// writes directly into `<bismuthHome>/skills/<id>` for every id WITHOUT going through stageSkills(), so
// those tests stay independent of stageSkills()'s own correctness (sabotaging stageSkills alone
// must fail only the "skills are staged" test, not this one too).
function seedStagedSkill(bismuthHome: string): void {
    for (const id of SKILL_IDS) {
        const skillDir = join(bismuthHome, 'skills', id)
        mkdirSync(skillDir, { recursive: true })
        writeFileSync(join(skillDir, 'SKILL.md'), `# ${id}\n`)
    }
}

test('skills are staged alongside docs (real fs, temp home)', () => {
    withTempDirs((bismuthHome, _claudeSkillsDir, src) => {
        writeFixtureSkill(src)
        stageSkills(src, bismuthHome)
        for (const id of SKILL_IDS) {
            expect(
                existsSync(join(bismuthHome, 'skills', id, 'SKILL.md')),
            ).toBe(true)
            expect(
                existsSync(
                    join(bismuthHome, 'skills', id, 'references', 'table.md'),
                ),
            ).toBe(true)
        }
    })
})

test('the Claude Code skill entry is created as a symlink into the staged skill', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)

        expect(areSkillsLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            false,
        ) // not linked yet

        const all = linkAllSkillsToClaudeCode(bismuthHome, claudeSkillsDir)
        expect(all).toEqual({ ok: true, warnings: [] })

        for (const id of SKILL_IDS) {
            const linkPath = join(claudeSkillsDir, id)
            expect(lstatSync(linkPath).isSymbolicLink()).toBe(true)
            expect(readlinkSync(linkPath)).toBe(join(bismuthHome, 'skills', id))
            // Followed through the symlink, the real content is there.
            expect(existsSync(join(linkPath, 'SKILL.md'))).toBe(true)
            expect(
                isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir, id),
            ).toBe(true)
            // Relinking our own link is clean and idempotent.
            expect(
                linkSkillToClaudeCode(bismuthHome, claudeSkillsDir, id),
            ).toEqual({ ok: true })
        }
        expect(areSkillsLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
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
        const foreignId = SKILL_IDS[1]
        const foreignPath = join(claudeSkillsDir, foreignId)
        mkdirSync(foreignPath, { recursive: true })
        writeFileSync(join(foreignPath, 'SKILL.md'), "# Someone else's skill\n")

        const r = linkSkillToClaudeCode(bismuthHome, claudeSkillsDir, foreignId)
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
        expect(
            isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir, foreignId),
        ).toBe(false)
    })
})

test('one foreign entry leaves the other skills linked, warns once naming that id, and the set reads as not linked', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)
        const foreignId = 'converting-bismuth-to-obsidian'
        mkdirSync(join(claudeSkillsDir, foreignId), { recursive: true })

        const r = linkAllSkillsToClaudeCode(bismuthHome, claudeSkillsDir)
        expect(r.ok).toBe(false)
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0]).toContain(foreignId)
        for (const id of SKILL_IDS) {
            expect(
                isSkillLinkedToClaudeCode(bismuthHome, claudeSkillsDir, id),
            ).toBe(id !== foreignId)
        }
        expect(areSkillsLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            false,
        )
    })
})

test('an uncreatable skills dir is one deduped warning, never a throw', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)
        // A FILE where the skills dir should be makes mkdirSync fail for every id.
        mkdirSync(join(claudeSkillsDir, '..'), { recursive: true })
        writeFileSync(claudeSkillsDir, 'not a dir')
        const r = linkAllSkillsToClaudeCode(bismuthHome, claudeSkillsDir)
        expect(r.ok).toBe(false)
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0]).toContain('could not create')
    })
})

test('a foreign symlink pointing elsewhere is also treated as not ours and left alone', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)

        // A symlink that exists but points OUTSIDE bismuthHome — not ours, even though it's a symlink.
        mkdirSync(claudeSkillsDir, { recursive: true })
        const elsewhere = tempDir('bismuth-install-elsewhere-')
        try {
            const id = SKILL_IDS[2]
            symlinkSync(elsewhere, join(claudeSkillsDir, id))
            const r = linkSkillToClaudeCode(bismuthHome, claudeSkillsDir, id)
            expect(r.ok).toBe(false)
            expect(r.warning).toContain("wasn't created by Bismuth")
            expect(readlinkSync(join(claudeSkillsDir, id))).toBe(
                elsewhere,
            )
        } finally {
            rmSync(elsewhere, { recursive: true, force: true })
        }
    })
})

test('linking only one skill leaves areSkillsLinkedToClaudeCode false (real fs, temp home)', () => {
    withTempDirs((bismuthHome, claudeSkillsDir, _src) => {
        seedStagedSkill(bismuthHome)
        const r = linkSkillToClaudeCode(
            bismuthHome,
            claudeSkillsDir,
            'authoring-bismuth-bases',
        )
        expect(r.ok).toBe(true)
        expect(areSkillsLinkedToClaudeCode(bismuthHome, claudeSkillsDir)).toBe(
            false,
        )
    })
})
