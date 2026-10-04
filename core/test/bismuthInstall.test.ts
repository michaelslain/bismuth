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
    removeLegacySkills,
    claudeMcpAddArgs,
    LEGACY_SKILL_IDS,
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
        legacyWarnings?: string[]
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
        mcpRegistered: async () => opts.mcp ?? false,
        installFiles: () => {
            calls.push('installFiles')
        },
        linkCli: () => {
            calls.push('linkCli')
            return { ok: true, path: '/usr/local/bin/bismuth' }
        },
        removeLegacySkills: () => {
            calls.push('removeLegacySkills')
            return opts.legacyWarnings ?? []
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
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('up-to-date')
    // No install work — only the idempotent legacy-skill cleanup runs.
    expect(calls).toEqual(['removeLegacySkills'])
})

test('reinstalls when the source hash changed', async () => {
    const { io, calls } = fakeIO({
        hash: 'H2',
        marker: 'H1',
        cli: true,
        mcp: true,
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('updated')
    expect(calls).toEqual([
        'installFiles',
        'linkCli',
        'removeLegacySkills',
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
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('updated')
    expect(calls).toContain('linkCli')
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

test('legacy-skill cleanup runs even when the install is otherwise up to date', async () => {
    const { io, calls } = fakeIO({
        hash: 'H',
        marker: 'H',
        cli: true,
        mcp: true,
        legacyWarnings: ['w-legacy'],
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.action).toBe('up-to-date')
    expect(calls).toEqual(['removeLegacySkills'])
    expect(r.warnings).toEqual(['w-legacy'])
})

test('dry-run does not run the legacy-skill cleanup, even when up to date', async () => {
    const { io, calls } = fakeIO({
        hash: 'H',
        marker: 'H',
        cli: true,
        mcp: true,
    })
    const r = await ensureBismuthInstalled('/src', io, { dryRun: true })
    expect(r.action).toBe('up-to-date')
    expect(calls).toEqual([])
})

test('every warning from removeLegacySkills is surfaced on the result', async () => {
    const { io } = fakeIO({
        hash: 'H',
        marker: null,
        legacyWarnings: ['w-one', 'w-two'],
    })
    const r = await ensureBismuthInstalled('/src', io)
    expect(r.warnings).toEqual(expect.arrayContaining(['w-one', 'w-two']))
})

test('getBismuthStatus reflects marker + link + mcp', async () => {
    const s = await getBismuthStatus(
        fakeIO({ marker: 'H', cli: true, mcp: true }).io,
    )
    expect(s).toMatchObject({
        installed: true,
        version: 'H',
        cliLinked: true,
        mcpRegistered: true,
    })
})

// --- Real-fs coverage for the legacy-skill cleanup ---------------------------------------
//
// The InstallIO fakes above only record which methods were called. To prove the ACTUAL removal
// logic, these exercise the real, exported home-parameterized removeLegacySkills() against
// throwaway temp dirs standing in for ~/.bismuth and ~/.claude/skills — never the developer's
// real home. Every temp dir is removed after each test.

function withTempDirs<T>(
    fn: (bismuthHome: string, claudeSkillsDir: string) => T,
): T {
    const bismuthHome = tempDir('bismuth-install-home-')
    const claudeHome = tempDir('bismuth-install-claude-')
    const claudeSkillsDir = join(claudeHome, 'skills')
    try {
        return fn(bismuthHome, claudeSkillsDir)
    } finally {
        rmSync(bismuthHome, { recursive: true, force: true })
        rmSync(claudeHome, { recursive: true, force: true })
    }
}

// What an older build left behind: ~/.bismuth/skills/<id> + a ~/.claude/skills/<id> symlink to it.
function seedLegacyInstall(bismuthHome: string, claudeSkillsDir: string): void {
    mkdirSync(claudeSkillsDir, { recursive: true })
    for (const id of LEGACY_SKILL_IDS) {
        const staged = join(bismuthHome, 'skills', id)
        mkdirSync(staged, { recursive: true })
        writeFileSync(join(staged, 'SKILL.md'), `# ${id}\n`)
        symlinkSync(staged, join(claudeSkillsDir, id), 'dir')
    }
}

test('removeLegacySkills removes our symlinks and ~/.bismuth/skills', () => {
    withTempDirs((bismuthHome, claudeSkillsDir) => {
        seedLegacyInstall(bismuthHome, claudeSkillsDir)
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
        for (const id of LEGACY_SKILL_IDS)
            expect(
                lstatSync(join(claudeSkillsDir, id), { throwIfNoEntry: false }),
            ).toBeUndefined()
        expect(existsSync(join(bismuthHome, 'skills'))).toBe(false)
    })
})

test('removeLegacySkills removes our dangling symlinks too (target already gone)', () => {
    withTempDirs((bismuthHome, claudeSkillsDir) => {
        seedLegacyInstall(bismuthHome, claudeSkillsDir)
        rmSync(join(bismuthHome, 'skills'), { recursive: true, force: true })
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
        for (const id of LEGACY_SKILL_IDS)
            expect(
                lstatSync(join(claudeSkillsDir, id), { throwIfNoEntry: false }),
            ).toBeUndefined()
    })
})

test('removeLegacySkills leaves a foreign directory, a foreign symlink and unrelated skills alone', () => {
    withTempDirs((bismuthHome, claudeSkillsDir) => {
        seedLegacyInstall(bismuthHome, claudeSkillsDir)
        // Replace two of ours with foreign entries: a real directory, and a symlink pointing elsewhere.
        const [dirId, linkId, ourId] = LEGACY_SKILL_IDS
        const dirPath = join(claudeSkillsDir, dirId)
        rmSync(dirPath)
        mkdirSync(dirPath)
        writeFileSync(join(dirPath, 'SKILL.md'), "# Someone else's skill\n")
        const elsewhere = tempDir('bismuth-install-elsewhere-')
        const linkPath = join(claudeSkillsDir, linkId)
        rmSync(linkPath)
        symlinkSync(elsewhere, linkPath)
        // And a skill that was never ours.
        const otherPath = join(claudeSkillsDir, 'my-own-skill')
        mkdirSync(otherPath)
        try {
            expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
            expect(lstatSync(dirPath).isDirectory()).toBe(true)
            expect(readFileSync(join(dirPath, 'SKILL.md'), 'utf8')).toBe(
                "# Someone else's skill\n",
            )
            expect(readlinkSync(linkPath)).toBe(elsewhere)
            expect(existsSync(otherPath)).toBe(true)
            // The one that WAS ours is gone.
            expect(
                lstatSync(join(claudeSkillsDir, ourId), {
                    throwIfNoEntry: false,
                }),
            ).toBeUndefined()
        } finally {
            rmSync(elsewhere, { recursive: true, force: true })
        }
    })
})

test('removeLegacySkills is a no-op when nothing is there, and idempotent', () => {
    withTempDirs((bismuthHome, claudeSkillsDir) => {
        // Neither ~/.claude/skills nor ~/.bismuth/skills exists.
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
        expect(existsSync(claudeSkillsDir)).toBe(false) // never creates the skills dir
        seedLegacyInstall(bismuthHome, claudeSkillsDir)
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
    })
})

test('removeLegacySkills removes ~/.bismuth/skills even when no link exists', () => {
    withTempDirs((bismuthHome, claudeSkillsDir) => {
        mkdirSync(join(bismuthHome, 'skills', 'whatever'), { recursive: true })
        expect(removeLegacySkills(bismuthHome, claudeSkillsDir)).toEqual([])
        expect(existsSync(join(bismuthHome, 'skills'))).toBe(false)
    })
})

test('the registered MCP server spec no longer carries BISMUTH_SKILLS_DIR', () => {
    const args = claudeMcpAddArgs()
    expect(args.some(a => a.startsWith('BISMUTH_SKILLS_DIR='))).toBe(false)
    expect(args.some(a => a.startsWith('BISMUTH_DOCS_DIR='))).toBe(true)
})
