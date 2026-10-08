// core/test/gcal/rekey.test.ts
// the base re-key + the move re-key: a renamed synced calendar keeps its sync links.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempDir } from '../helpers'
import {
    readManifest,
    writeManifest,
    manifestKey,
    gcalDir,
    rekeyBaseSyncUnlocked,
    rekeyPairsUnlocked,
    movedSyncPairs,
} from '../../src/gcal/manifest'
import { withSyncLock, SyncLocked } from '../../src/gcal/lock'

type Opts = { claimLegacy?: boolean; home?: string }

/** One base re-keyed under the sync lock, as the migrate command does. */
const rekeyBaseSync = async (v: string, f: string, t: string, o: Opts = {}) =>
    existsSync(join(gcalDir(o.home), 'sync.json'))
        ? withSyncLock(
              async () => rekeyBaseSyncUnlocked(v, f, t, o).moved,
              o.home,
          )
        : false

/** Every synced base under a moved path re-keyed under the lock; returns the snapshot undo. */
async function rekeyMovedSync(v: string, f: string, t: string, o: Opts = {}) {
    const pairs = movedSyncPairs(v, f, t, o)
    if (pairs.length === 0) return null
    const r = await withSyncLock(
        async () => rekeyPairsUnlocked(v, pairs, o),
        o.home,
    )
    return () => withSyncLock(async () => r.restore(), o.home)
}

let home: string
const vault = '/nonexistent-vault-for-rekey'
beforeEach(() => {
    home = tempDir('bismuth-gcal-rekey-')
})
afterEach(() => {
    rmSync(home, { recursive: true, force: true })
})
const entry = (id: string) => ({
    links: { g1: { bismuthId: id } },
    syncToken: 't',
})

test('no manifest: false and nothing created', async () => {
    const empty = join(home, 'nothing')
    expect(
        await rekeyBaseSync(vault, 'a.base.jsonl', 'b.base.jsonl', {
            home: empty,
        }),
    ).toBe(false)
    expect(existsSync(gcalDir(empty))).toBe(false)
})

test('namespaced key moves', async () => {
    writeManifest(
        { bases: { [manifestKey(vault, 'a.base.jsonl')]: entry('x') } },
        home,
    )
    expect(
        await rekeyBaseSync(vault, 'a.base.jsonl', 'b.base.jsonl', { home }),
    ).toBe(true)
    const m = readManifest(home)
    expect(Object.keys(m.bases)).toEqual([manifestKey(vault, 'b.base.jsonl')])
    expect(
        m.bases[manifestKey(vault, 'b.base.jsonl')]!.links.g1!.bismuthId,
    ).toBe('x')
})

test('bare legacy key moves only with claimLegacy', async () => {
    writeManifest({ bases: { 'a.base.jsonl': entry('x') } }, home)
    expect(
        await rekeyBaseSync(vault, 'a.base.jsonl', 'b.base.jsonl', { home }),
    ).toBe(false)
    expect(Object.keys(readManifest(home).bases)).toEqual(['a.base.jsonl'])
    expect(
        await rekeyBaseSync(vault, 'a.base.jsonl', 'b.base.jsonl', {
            home,
            claimLegacy: true,
        }),
    ).toBe(true)
    expect(Object.keys(readManifest(home).bases)).toEqual([
        manifestKey(vault, 'b.base.jsonl'),
    ])
})

test('lock held throws SyncLocked and leaves the manifest unchanged', async () => {
    const k = manifestKey(vault, 'a.base.jsonl')
    writeManifest({ bases: { [k]: entry('x') } }, home)
    await withSyncLock(async () => {
        await expect(
            rekeyBaseSync(vault, 'a.base.jsonl', 'b.base.jsonl', { home }),
        ).rejects.toBeInstanceOf(SyncLocked)
    }, home)
    expect(Object.keys(readManifest(home).bases)).toEqual([k])
})

test('folder move re-keys each base under it and ignores others', async () => {
    writeManifest(
        {
            bases: {
                [manifestKey(vault, 'cal/a.base.jsonl')]: entry('a'),
                [manifestKey(vault, 'cal/sub/b.base.jsonl')]: entry('b'),
                [manifestKey(vault, 'calx/c.base.jsonl')]: entry('c'),
            },
        },
        home,
    )
    const undo = await rekeyMovedSync(vault, 'cal', 'work', { home })
    expect(Object.keys(readManifest(home).bases).sort()).toEqual(
        [
            manifestKey(vault, 'calx/c.base.jsonl'),
            manifestKey(vault, 'work/a.base.jsonl'),
            manifestKey(vault, 'work/sub/b.base.jsonl'),
        ].sort(),
    )
    await undo!()
    expect(Object.keys(readManifest(home).bases)).toContain(
        manifestKey(vault, 'cal/a.base.jsonl'),
    )
})

test('moving an unsynced path creates no gcal dir', async () => {
    const empty = join(home, 'none')
    expect(
        await rekeyMovedSync(vault, 'x.md', 'y.md', { home: empty }),
    ).toBeNull()
    expect(existsSync(gcalDir(empty))).toBe(false)
})

test('POST /move re-keys a synced base, and a plain move creates no gcal dir', async () => {
    const { createServer } = await import('../../src/server')
    const { writeNote } = await import('../../src/files')
    const { makeSampleVault } = await import('../helpers')
    const { vault, memory } = await makeSampleVault()
    const prev = process.env.BISMUTH_GCAL_DIR
    const dir = join(home, 'route-gcal')
    process.env.BISMUTH_GCAL_DIR = dir
    const server = createServer({ vault, memory, port: 0 })
    const post = (body: unknown) =>
        fetch(`http://localhost:${server.port}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
    try {
        await writeNote(vault, 'plain.md', 'x')
        expect((await post({ from: 'plain.md', to: 'plain2.md' })).status).toBe(
            200,
        )
        expect(existsSync(dir)).toBe(false)

        mkdirSync(join(vault, 'cal'), { recursive: true })
        writeFileSync(join(vault, 'cal', 'a.base.jsonl'), '{}\n')
        writeManifest({
            bases: { [manifestKey(vault, 'cal/a.base.jsonl')]: entry('x') },
        })
        expect((await post({ from: 'cal', to: 'work' })).status).toBe(200)
        expect(Object.keys(readManifest().bases)).toEqual([
            manifestKey(vault, 'work/a.base.jsonl'),
        ])
    } finally {
        server.stop(true)
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
})

test('POST /move: held lock answers 409, nothing moved, manifest unchanged', async () => {
    const { createServer } = await import('../../src/server')
    const { makeSampleVault } = await import('../helpers')
    const { vault, memory } = await makeSampleVault()
    const prev = process.env.BISMUTH_GCAL_DIR
    const dir = join(home, 'route-gcal-lock')
    process.env.BISMUTH_GCAL_DIR = dir
    const server = createServer({ vault, memory, port: 0 })
    try {
        writeFileSync(join(vault, 'a.base.jsonl'), '{}\n')
        const m = {
            bases: { [manifestKey(vault, 'a.base.jsonl')]: entry('a') },
        }
        writeManifest(m)
        writeFileSync(join(dir, 'sync.lock'), `${process.pid} now`)
        const r = await fetch(`http://localhost:${server.port}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'a.base.jsonl', to: 'b.base.jsonl' }),
        })
        expect(r.status).toBe(409)
        expect(existsSync(join(vault, 'a.base.jsonl'))).toBe(true)
        expect(existsSync(join(vault, 'b.base.jsonl'))).toBe(false)
        expect(readManifest()).toEqual(m)
    } finally {
        server.stop(true)
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
})

test('a move onto an existing synced key is refused and both entries survive', async () => {
    writeManifest(
        {
            bases: {
                [manifestKey(vault, 'a.base.jsonl')]: entry('A'),
                [manifestKey(vault, 'b.base.jsonl')]: entry('B'),
            },
        },
        home,
    )
    const before = readManifest(home)
    await expect(
        rekeyMovedSync(vault, 'a.base.jsonl', 'b.base.jsonl', { home }),
    ).rejects.toThrow()
    expect(readManifest(home)).toEqual(before)
})

test('POST /move onto an existing synced base: refused, files and both entries survive', async () => {
    const { createServer } = await import('../../src/server')
    const { makeSampleVault } = await import('../helpers')
    const { vault, memory } = await makeSampleVault()
    const prev = process.env.BISMUTH_GCAL_DIR
    process.env.BISMUTH_GCAL_DIR = join(home, 'route-gcal-collide')
    const server = createServer({ vault, memory, port: 0 })
    try {
        writeFileSync(join(vault, 'a.base.jsonl'), '{}\n')
        writeFileSync(join(vault, 'b.base.jsonl'), '{}\n')
        const m = {
            bases: {
                [manifestKey(vault, 'a.base.jsonl')]: entry('A'),
                [manifestKey(vault, 'b.base.jsonl')]: entry('B'),
            },
        }
        writeManifest(m)
        const r = await fetch(`http://localhost:${server.port}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'a.base.jsonl', to: 'b.base.jsonl' }),
        })
        expect(r.status).toBe(409)
        expect(readManifest()).toEqual(m)
        expect(existsSync(join(vault, 'a.base.jsonl'))).toBe(true)
    } finally {
        server.stop(true)
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
})

test('a move failing after the re-key restores the snapshot', async () => {
    const { createServer } = await import('../../src/server')
    const { makeSampleVault } = await import('../helpers')
    const { vault, memory } = await makeSampleVault()
    const prev = process.env.BISMUTH_GCAL_DIR
    process.env.BISMUTH_GCAL_DIR = join(home, 'route-gcal-fail')
    const server = createServer({ vault, memory, port: 0 })
    try {
        // dir/ holds the synced base; the destination's parent is a FILE, so mkdir inside
        // moveEntry fails after the re-key ran.
        mkdirSync(join(vault, 'dir'))
        writeFileSync(join(vault, 'dir', 'a.base.jsonl'), '{}\n')
        writeFileSync(join(vault, 'blocker'), 'x')
        const m = {
            bases: { [manifestKey(vault, 'dir/a.base.jsonl')]: entry('A') },
        }
        writeManifest(m)
        const r = await fetch(`http://localhost:${server.port}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'dir', to: 'blocker/inner' }),
        })
        expect(r.status).toBeGreaterThanOrEqual(400)
        expect(readManifest()).toEqual(m)
        expect(existsSync(join(vault, 'dir', 'a.base.jsonl'))).toBe(true)
    } finally {
        server.stop(true)
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
})

test('POST /move onto a path whose file is absent but whose manifest key exists: 409, nothing moved', async () => {
    const { createServer } = await import('../../src/server')
    const { makeSampleVault } = await import('../helpers')
    const { vault, memory } = await makeSampleVault()
    const prev = process.env.BISMUTH_GCAL_DIR
    process.env.BISMUTH_GCAL_DIR = join(home, 'route-gcal-ghost')
    const server = createServer({ vault, memory, port: 0 })
    try {
        writeFileSync(join(vault, 'a.base.jsonl'), '{}\n')
        const m = {
            bases: {
                [manifestKey(vault, 'a.base.jsonl')]: entry('A'),
                [manifestKey(vault, 'b.base.jsonl')]: entry('B'),
            },
        }
        writeManifest(m)
        const r = await fetch(`http://localhost:${server.port}/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'a.base.jsonl', to: 'b.base.jsonl' }),
        })
        expect(r.status).toBe(409)
        expect(readManifest()).toEqual(m)
        expect(existsSync(join(vault, 'a.base.jsonl'))).toBe(true)
        expect(existsSync(join(vault, 'b.base.jsonl'))).toBe(false)
    } finally {
        server.stop(true)
        if (prev === undefined) delete process.env.BISMUTH_GCAL_DIR
        else process.env.BISMUTH_GCAL_DIR = prev
    }
})
