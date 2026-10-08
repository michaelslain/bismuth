import { test as bunTest, expect, describe } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

async function cli(vault: string, ...args: string[]): Promise<Run> {
    const env: Record<string, string | undefined> = { ...process.env }
    delete env.BISMUTH_AGENT_CHANNEL
    delete env.BISMUTH_MCP_CHANNEL
    delete env.BISMUTH_VAULT
    delete env.BISMUTH_APP_PATH
    env.BROWSER = 'none'
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

const withGcal = async (fn: (gdir: string) => Promise<void>) => {
    const root = mkdtempSync(join(tmpdir(), 'bismuth-gcal-'))
    const gdir = join(root, 'gcal')
    const prev = process.env.BISMUTH_GCAL_DIR
    process.env.BISMUTH_GCAL_DIR = gdir
    try {
        await fn(gdir)
    } finally {
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
        rmSync(root, { recursive: true, force: true })
    }
}

const entry = { links: { g1: { bismuthId: 'e1', etag: 'x' } }, syncToken: 't' }

describe('move / restore carry Google sync state', () => {
    test('move with ./ and trailing-slash spellings re-keys the manifest', () =>
        withGcal(async () => {
            const vault = makeVault({ 'Cal.base.jsonl': '{}\n' })
            writeManifest({
                bases: { [manifestKey(vault, 'Cal.base.jsonl')]: entry },
            })
            const r = await cli(
                vault,
                'move',
                './Cal.base.jsonl',
                'Work.base.jsonl',
            )
            expect(r.code, r.stderr).toBe(0)
            expect(existsSync(join(vault, 'Work.base.jsonl'))).toBe(true)
            expect(Object.keys(readManifest().bases)).toEqual([
                manifestKey(vault, 'Work.base.jsonl'),
            ])
            expect(
                readManifest().bases[manifestKey(vault, 'Work.base.jsonl')],
            ).toEqual(entry)
        }))

    test('a folder spelled with a trailing slash re-keys the bases under it', () =>
        withGcal(async () => {
            const vault = makeVault({ 'cal/A.base.jsonl': '{}\n' })
            writeManifest({
                bases: { [manifestKey(vault, 'cal/A.base.jsonl')]: entry },
            })
            const r = await cli(vault, 'move', 'cal/', 'work')
            expect(r.code, r.stderr).toBe(0)
            expect(Object.keys(readManifest().bases)).toEqual([
                manifestKey(vault, 'work/A.base.jsonl'),
            ])
        }))

    test('restore of a trashed synced base keeps the sync state on the restored path', () =>
        withGcal(async () => {
            const vault = makeVault({ 'Cal.base.jsonl': '{}\n' })
            writeManifest({
                bases: { [manifestKey(vault, 'Cal.base.jsonl')]: entry },
            })
            const d = await cli(vault, 'delete', 'Cal.base.jsonl', '--json')
            expect(d.code, d.stderr).toBe(0)
            const trashPath = JSON.parse(d.stdout).trashPath as string
            const r = await cli(vault, 'restore', trashPath, 'Cal.base.jsonl')
            expect(r.code, r.stderr).toBe(0)
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(true)
            expect(readManifest().bases).toEqual({
                [manifestKey(vault, 'Cal.base.jsonl')]: entry,
            })
        }))

    test('a held sync lock refuses the move with a clear error and moves nothing', () =>
        withGcal(async gdir => {
            const vault = makeVault({ 'Cal.base.jsonl': '{}\n' })
            const m = {
                bases: { [manifestKey(vault, 'Cal.base.jsonl')]: entry },
            }
            writeManifest(m)
            writeFileSync(join(gdir, 'sync.lock'), `${process.pid} now`)
            const r = await cli(vault, 'move', 'Cal.base.jsonl', 'W.base.jsonl')
            expect(r.code).not.toBe(0)
            expect(existsSync(join(vault, 'Cal.base.jsonl'))).toBe(true)
            expect(readManifest()).toEqual(m)
        }))
})
