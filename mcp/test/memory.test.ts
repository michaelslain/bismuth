import { test, expect, beforeEach, afterEach, afterAll, describe } from 'bun:test'
import { tempDir, sweepTempDirs } from './tempDirs'
import {
    mkdirSync,
    writeFileSync,
    readFileSync,
    existsSync,
    realpathSync,
} from 'node:fs'
import { join } from 'node:path'
import {
    memoryDir,
    resolveVaultRoot,
    remember,
    recall,
    forget,
} from '../src/memory'

// memoryDir() is the ONE gate shared by the memory tools (remember/recall/forget) and the
// daemon-management tools (daemonEnabled() in daemon.ts, which is defined as memoryDir() !=
// null). Row 82: memory tools never appeared because BISMUTH_MEMORY_DIR was ONLY ever set by
// core/src/terminal.ts (an in-app Bismuth terminal tab) or the daemon's own session wiring —
// never for a normal interactive `claude` session (a plain terminal/IDE), even though the
// machine-wide install (bismuthInstall.ts's `claude mcp add -s user`) puts the bismuth MCP in
// EVERY such session. memoryDir() now falls back to resolving the vault itself (BISMUTH_VAULT,
// else cwd walked up to a `.settings` file) and checking that vault's OWN daemon.enabled —
// without weakening the gate to "some vault exists nearby".

const MEM = process.env.BISMUTH_MEMORY_DIR
const VAULT = process.env.BISMUTH_VAULT
const CWD = process.cwd()

// Every test starts from a clean slate: no ambient BISMUTH_MEMORY_DIR/BISMUTH_VAULT, cwd in a
// fresh empty (realpath'd, so exact-path assertions below are stable) temp dir — so these can't
// pass/fail depending on the developer's own shell env or invocation directory.
let noVaultDir: string

beforeEach(() => {
    delete process.env.BISMUTH_MEMORY_DIR
    delete process.env.BISMUTH_VAULT
    noVaultDir = realpathSync(
        tempDir('bismuth-mcp-memory-test-'),
    )
    process.chdir(noVaultDir)
})

afterEach(() => {
    if (MEM === undefined) delete process.env.BISMUTH_MEMORY_DIR
    else process.env.BISMUTH_MEMORY_DIR = MEM
    if (VAULT === undefined) delete process.env.BISMUTH_VAULT
    else process.env.BISMUTH_VAULT = VAULT
    process.chdir(CWD)
})

afterAll(sweepTempDirs)

/** Write a vault's `.settings` with (or without) a top-level `daemon.enabled` key. */
function writeVaultSettings(vault: string, enabled: boolean | undefined): void {
    mkdirSync(vault, { recursive: true })
    const yaml =
        enabled === undefined
            ? 'appearance:\n  theme: dark\n'
            : `daemon:\n  enabled: ${enabled}\n`
    writeFileSync(join(vault, '.settings'), yaml)
}

test('BISMUTH_MEMORY_DIR, when already set, is trusted as-is (no vault/.settings lookup)', () => {
    process.env.BISMUTH_MEMORY_DIR = '/some/arbitrary/dir'
    expect(memoryDir()).toBe('/some/arbitrary/dir')
})

test('no env vars and cwd outside any vault -> resolveVaultRoot/memoryDir are both null', () => {
    expect(resolveVaultRoot()).toBeNull()
    expect(memoryDir()).toBeNull()
})

test("BISMUTH_VAULT + that vault's .settings has daemon.enabled:true -> resolves <vault>/.daemon/memory", () => {
    const vault = join(noVaultDir, 'vault')
    writeVaultSettings(vault, true)
    process.env.BISMUTH_VAULT = vault
    expect(resolveVaultRoot()).toBe(vault)
    expect(memoryDir()).toBe(join(vault, '.daemon', 'memory'))
})

test('BISMUTH_VAULT with daemon.enabled:false -> null (the gate is not weakened)', () => {
    const vault = join(noVaultDir, 'vault')
    writeVaultSettings(vault, false)
    process.env.BISMUTH_VAULT = vault
    expect(memoryDir()).toBeNull()
})

test('BISMUTH_VAULT whose .settings has no daemon key at all -> null', () => {
    const vault = join(noVaultDir, 'vault')
    writeVaultSettings(vault, undefined)
    process.env.BISMUTH_VAULT = vault
    expect(memoryDir()).toBeNull()
})

test('BISMUTH_VAULT pointing at a vault with no .settings file -> null', () => {
    const vault = join(noVaultDir, 'vault')
    mkdirSync(vault, { recursive: true })
    process.env.BISMUTH_VAULT = vault
    expect(memoryDir()).toBeNull()
})

test("cwd walked up to a daemon-enabled vault's .settings resolves memoryDir (the machine-wide, non-Bismuth-terminal case)", () => {
    const vault = join(noVaultDir, 'vault')
    writeVaultSettings(vault, true)
    const nested = join(vault, 'notes', 'deep')
    mkdirSync(nested, { recursive: true })
    process.chdir(nested)

    expect(resolveVaultRoot()).toBe(vault)
    expect(memoryDir()).toBe(join(vault, '.daemon', 'memory'))
})

test('cwd walked up to a daemon-DISABLED vault -> null, even though a vault is found', () => {
    const vault = join(noVaultDir, 'vault')
    writeVaultSettings(vault, false)
    process.chdir(vault)
    expect(resolveVaultRoot()).toBe(vault)
    expect(memoryDir()).toBeNull()
})

test('malformed .settings YAML degrades to null, never throws', () => {
    const vault = join(noVaultDir, 'vault')
    mkdirSync(vault, { recursive: true })
    writeFileSync(join(vault, '.settings'), 'daemon: [this is not valid yaml')
    process.env.BISMUTH_VAULT = vault
    expect(() => memoryDir()).not.toThrow()
    expect(memoryDir()).toBeNull()
})

test('BISMUTH_VAULT takes priority over an ambient vault found via cwd', () => {
    const cwdVault = join(noVaultDir, 'cwd-vault')
    writeVaultSettings(cwdVault, true)
    process.chdir(cwdVault)

    const explicitVault = join(noVaultDir, 'explicit-vault')
    writeVaultSettings(explicitVault, true)
    process.env.BISMUTH_VAULT = explicitVault

    expect(resolveVaultRoot()).toBe(explicitVault)
    expect(memoryDir()).toBe(join(explicitVault, '.daemon', 'memory'))
})

// ── remember / forget vs. restricted memory notes ──────────────────────────────────────────────
// `remember` rebuilt the frontmatter without `visibility`, so overwriting a hidden note silently
// un-hid it. The owner keeps the value; an agent may not touch a note it cannot see at all.

describe('remember/forget and memory-note visibility', () => {
    let memDir: string

    beforeEach(() => {
        memDir = join(noVaultDir, 'memory')
        mkdirSync(memDir, { recursive: true })
    })

    const noteFile = (name: string) => join(memDir, `${name}.md`)
    const seed = (name: string, visibility?: 'hidden' | 'chat-only') =>
        writeFileSync(
            noteFile(name),
            `---\ntype: fact\ntags: [a]\ncreated: 2026-01-01\nupdated: 2026-01-01${
                visibility ? `\nvisibility: ${visibility}` : ''
            }\n---\n\nORIGINALBODY\n`,
        )

    test('owner remember over a hidden note keeps visibility: hidden', async () => {
        seed('secret', 'hidden')
        await remember({ name: 'secret', content: 'NEWBODY' }, memDir)
        const raw = readFileSync(noteFile('secret'), 'utf8')
        expect(raw).toContain('visibility: hidden')
        expect(raw).toContain('NEWBODY')
    })

    test('owner remember over a chat-only note keeps visibility: chat-only', async () => {
        seed('chatty', 'chat-only')
        await remember(
            { name: 'chatty', content: 'NEWBODY' },
            memDir,
            { channel: null },
        )
        expect(readFileSync(noteFile('chatty'), 'utf8')).toContain(
            'visibility: chat-only',
        )
    })

    test('remember of a brand-new note writes no visibility line', async () => {
        await remember({ name: 'fresh', content: 'x' }, memDir, {
            channel: 'daemon',
        })
        expect(readFileSync(noteFile('fresh'), 'utf8')).not.toContain(
            'visibility',
        )
    })

    test('daemon remember on a hidden or chat-only note is refused, file unchanged', async () => {
        seed('secret', 'hidden')
        seed('chatty', 'chat-only')
        const before = {
            secret: readFileSync(noteFile('secret'), 'utf8'),
            chatty: readFileSync(noteFile('chatty'), 'utf8'),
        }
        for (const name of ['secret', 'chatty'] as const) {
            await expect(
                remember({ name, content: 'NEWBODY' }, memDir, {
                    channel: 'daemon',
                }),
            ).rejects.toThrow(
                'refused: that memory note is not visible to this agent',
            )
            expect(readFileSync(noteFile(name), 'utf8')).toBe(before[name])
        }
    })

    test('chat remember: refused on hidden, allowed on chat-only (and keeps it)', async () => {
        seed('secret', 'hidden')
        seed('chatty', 'chat-only')
        await expect(
            remember({ name: 'secret', content: 'NEWBODY' }, memDir, {
                channel: 'chat',
            }),
        ).rejects.toThrow('refused:')
        expect(readFileSync(noteFile('secret'), 'utf8')).toContain(
            'ORIGINALBODY',
        )
        await remember({ name: 'chatty', content: 'NEWBODY' }, memDir, {
            channel: 'chat',
        })
        const raw = readFileSync(noteFile('chatty'), 'utf8')
        expect(raw).toContain('NEWBODY')
        expect(raw).toContain('visibility: chat-only')
    })

    test('agent remember over a visible note still works', async () => {
        seed('open')
        await remember({ name: 'open', content: 'NEWBODY' }, memDir, {
            channel: 'daemon',
        })
        expect(readFileSync(noteFile('open'), 'utf8')).toContain('NEWBODY')
    })

    test('daemon forget on a hidden note is refused, file kept', async () => {
        seed('secret', 'hidden')
        await expect(
            forget({ name: 'secret' }, memDir, { channel: 'daemon' }),
        ).rejects.toThrow(
            'refused: that memory note is not visible to this agent',
        )
        expect(existsSync(noteFile('secret'))).toBe(true)
    })

    test('chat forget: refused on hidden, allowed on chat-only', async () => {
        seed('secret', 'hidden')
        seed('chatty', 'chat-only')
        await expect(
            forget({ name: 'secret' }, memDir, { channel: 'chat' }),
        ).rejects.toThrow('refused:')
        expect(existsSync(noteFile('secret'))).toBe(true)
        expect(
            (await forget({ name: 'chatty' }, memDir, { channel: 'chat' })).ok,
        ).toBe(true)
        expect(existsSync(noteFile('chatty'))).toBe(false)
    })

    test('owner forget removes a hidden note; forgetting a missing note is ok:false for an agent', async () => {
        seed('secret', 'hidden')
        expect((await forget({ name: 'secret' }, memDir)).ok).toBe(true)
        expect(existsSync(noteFile('secret'))).toBe(false)
        expect(
            (await forget({ name: 'nope' }, memDir, { channel: 'daemon' })).ok,
        ).toBe(false)
    })

    test('daemon recall excludes hidden and chat-only notes', async () => {
        seed('secret', 'hidden')
        seed('chatty', 'chat-only')
        seed('open')
        const res = await recall({ query: 'ORIGINALBODY' }, memDir)
        expect(res.notes.map(n => n.name)).toEqual(['open'])
    })
})

// ── remember: the description field ────────────────────────────────────────────────────────────
describe('remember description', () => {
    let memDir: string
    beforeEach(() => {
        memDir = join(tempDir('mem-desc-'), 'memory')
        mkdirSync(memDir, { recursive: true })
    })

    test('round-trips through remember + recall', async () => {
        await remember(
            { name: 'd1', content: 'body', description: 'when deploying: check the flag' },
            memDir,
        )
        const raw = readFileSync(join(memDir, 'd1.md'), 'utf8')
        expect(raw).toContain('description:')
        const got = await recall({ query: '' }, memDir)
        expect(got.notes.find(n => n.name === 'd1')?.frontmatter.description).toBe(
            'when deploying: check the flag',
        )
    })

    test('overwrite without a description keeps the old one; with one replaces it', async () => {
        await remember({ name: 'd2', content: 'a', description: 'old one' }, memDir)
        await remember({ name: 'd2', content: 'b' }, memDir)
        expect((await recall({ query: '' }, memDir)).notes[0].frontmatter.description).toBe('old one')
        await remember({ name: 'd2', content: 'c', description: 'new one' }, memDir)
        expect((await recall({ query: '' }, memDir)).notes[0].frontmatter.description).toBe('new one')
    })

    test('the CLI twin takes --description and keeps it on a bare overwrite', async () => {
        const { commands } = await import('../../cli/src/commands/memory')
        const run = commands['memory remember'].run
        const base = ['--name', 'cli1', '--content', 'x', '--memory', memDir]
        await run([...base, '--description', 'from the cli'])
        expect(readFileSync(join(memDir, 'cli1.md'), 'utf8')).toContain('description: from the cli')
        await run(base)
        expect(readFileSync(join(memDir, 'cli1.md'), 'utf8')).toContain('description: from the cli')
    })
})
