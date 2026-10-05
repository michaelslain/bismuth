import { test as bunTest, expect, describe } from 'bun:test'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { makeVault } from '../../core/test/helpers'
import { setFolderVisibility } from '../../core/src/settings'

// Own vault per case (the shared leak vault has well-formed rules). Spawns the real CLI the way an
// agent reaches it: BISMUTH_AGENT_CHANNEL (cli) or BISMUTH_MCP_CHANNEL (mcp); owner has neither.
const SPAWN_TIMEOUT_MS = 30_000
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, SPAWN_TIMEOUT_MS)

const MALFORMED = 'MALFORMEDTOKEN'
const OPEN = 'WALKOPENTOKEN'
const CLI = join(import.meta.dir, '..', 'src', 'index.ts')

type Who = { channel: 'owner' | 'daemon'; via?: 'cli' | 'mcp' }

async function run(args: string[], vault: string, who: Who) {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    env.BROWSER = 'none'
    if (who.channel !== 'owner') {
        if ((who.via ?? 'cli') === 'mcp') env.BISMUTH_MCP_CHANNEL = who.channel
        else env.BISMUTH_AGENT_CHANNEL = who.channel
    }
    const proc = Bun.spawn(['bun', 'run', CLI, ...args, '--vault', vault], {
        env,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

const DAEMONS: Who[] = [
    { channel: 'daemon', via: 'cli' },
    { channel: 'daemon', via: 'mcp' },
]

describe('malformed frontmatter', () => {
    const files = () => ({
        'open.md': `# Open\n${OPEN}\n`,
        'broken.md': `---\nvisibility: [hidden\n---\n# Broken\n${MALFORMED}\n\n- [ ] broken task ${MALFORMED}\n`,
    })

    for (const who of DAEMONS)
        test(`daemon via ${who.via}: task list and search omit the note`, async () => {
            const vault = makeVault(files())
            for (const args of [['task', 'list'], ['search', MALFORMED]]) {
                const r = await run(args, vault, who)
                expect(r.stdout, args.join(' ')).not.toContain(MALFORMED)
                expect(r.stderr, args.join(' ')).not.toContain(MALFORMED)
            }
        })

    test('owner still sees it', async () => {
        const vault = makeVault(files())
        const tasks = await run(['task', 'list'], vault, { channel: 'owner' })
        expect(tasks.code, tasks.stderr).toBe(0)
        expect(tasks.stdout).toContain(MALFORMED)
        const s = await run(['search', MALFORMED], vault, { channel: 'owner' })
        expect(s.stdout).toContain(MALFORMED)
    })
})

describe('unknown folderVisibility value', () => {
    const files = () => ({
        'open.md': `# Open\n${OPEN}\n`,
        'Vault Hidden/inner.md': `# Inner\n${MALFORMED}\n`,
        '.settings': 'folderVisibility:\n  Vault Hidden: hiden\n',
    })

    for (const who of DAEMONS)
        test(`daemon via ${who.via}: search is refused as undetermined`, async () => {
            const vault = makeVault(files())
            const r = await run(['search', MALFORMED], vault, who)
            expect(r.code).not.toBe(0)
            expect(r.stdout).not.toContain(MALFORMED)
            expect(r.stderr).toContain('a folderVisibility entry is not chat-only')
            expect(r.stderr).not.toContain('Vault Hidden')
        })

    test('owner is unaffected', async () => {
        const vault = makeVault(files())
        const r = await run(['search', MALFORMED], vault, { channel: 'owner' })
        expect(r.code, r.stderr).toBe(0)
        expect(r.stdout).toContain(MALFORMED)
    })
})

describe('trash in a restricted vault', () => {
    const files = () => ({
        'Private/secret.md': `---\nvisibility: hidden\n---\n# S\n${MALFORMED}\n`,
        '.trash/1700000000000-Vault Hidden/inner.md': `# Inner\n${MALFORMED}\n`,
    })
    const TRASHED = '.trash/1700000000000-Vault Hidden/inner.md'

    for (const who of DAEMONS)
        test(`daemon via ${who.via}: reading the trashed copy is refused`, async () => {
            const vault = makeVault(files())
            const r = await run(['read', TRASHED], vault, who)
            expect(r.code).not.toBe(0)
            expect(r.stdout).not.toContain(MALFORMED)
        })

    test('owner can read the trashed copy', async () => {
        const vault = makeVault(files())
        const r = await run(['read', TRASHED], vault, { channel: 'owner' })
        expect(r.code, r.stderr).toBe(0)
        expect(r.stdout).toContain(MALFORMED)
    })
})

describe('trash when the hidden folder itself is gone', () => {
    const TRASHED = '.trash/1-Private/a.md'
    for (const who of DAEMONS)
        test(`daemon via ${who.via}: the trashed copy of a hidden folder is refused`, async () => {
            const vault = makeVault({
                'Private/a.md': `# A\n${MALFORMED}\n`,
                [TRASHED]: `# A\n${MALFORMED}\n`,
            })
            await setFolderVisibility(vault, 'Private', 'hidden')
            rmSync(join(vault, 'Private'), { recursive: true })
            const r = await run(['read', TRASHED], vault, who)
            expect(r.code).not.toBe(0)
            expect(r.stdout).not.toContain(MALFORMED)
        })
})

describe('frontmatter over 64 KiB', () => {
    const files = () => ({
        'big.md': `---\nvisibility: hidden\nnote: ${'a'.repeat(64 * 1024 + 1)}\n---\n# Big\n${MALFORMED}\n`,
    })
    for (const who of DAEMONS)
        test(`daemon via ${who.via}: reading it is refused`, async () => {
            const vault = makeVault(files())
            const r = await run(['read', 'big.md'], vault, who)
            expect(r.code).not.toBe(0)
            expect(r.stdout).not.toContain(MALFORMED)
        })
})
