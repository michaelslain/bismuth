import { test as bunTest, expect } from 'bun:test'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
    readManifest,
    writeManifest,
    manifestKey,
} from '../../core/src/gcal/manifest'
import { makeVault } from '../../core/test/helpers'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const test = (name: string, fn: Parameters<typeof bunTest>[1]) =>
    bunTest(name, fn, 30_000)

type Run = { code: number; stdout: string; stderr: string }

async function cli(
    gcalDir: string,
    vault: string,
    ...args: string[]
): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    delete env.BISMUTH_APP_PATH
    env.BROWSER = 'none'
    env.BISMUTH_GCAL_DIR = gcalDir
    const proc = Bun.spawn(
        [
            'bun',
            'run',
            join(REPO_ROOT, 'cli/src/index.ts'),
            ...args,
            '--vault',
            vault,
        ],
        { cwd: REPO_ROOT, env, stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ])
    return { code, stdout, stderr }
}

const SYNCED = [
    '---',
    'type: base',
    'view: calendar',
    'googleCalendarSync: true',
    'googleCalendarId: primary',
    '---',
    '',
].join('\n')

const entry = { links: { g1: { bismuthId: 'e1' } } }

test('forgets the entry of a missing base, then reports none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
    process.env.BISMUTH_GCAL_DIR = dir
    const vault = makeVault({ 'n.md': '# n\n' })
    writeManifest({ bases: { [manifestKey(vault, 'Gone.md')]: entry } })
    const a = await cli(dir, vault, 'gcal', 'forget', 'Gone.md')
    expect(a.code).toBe(0)
    expect(a.stdout).toContain('forgot sync state for Gone.md')
    expect(readManifest().bases).toEqual({})
    const b = await cli(dir, vault, 'gcal', 'forget', 'Gone.md')
    expect(b.code).toBe(0)
    expect(b.stdout).toContain('no sync state for Gone.md')
})

test('refuses an existing synced base without --force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
    process.env.BISMUTH_GCAL_DIR = dir
    const vault = makeVault({ 'Cal.md': SYNCED })
    const key = manifestKey(vault, 'Cal.md')
    writeManifest({ bases: { [key]: entry } })
    const a = await cli(dir, vault, 'gcal', 'forget', 'Cal.md')
    expect(a.code).not.toBe(0)
    expect(a.stderr).toContain('still exists')
    expect(Object.keys(readManifest().bases)).toEqual([key])
    const b = await cli(dir, vault, 'gcal', 'forget', 'Cal.md', '--force')
    expect(b.code).toBe(0)
    expect(readManifest().bases).toEqual({})
})
