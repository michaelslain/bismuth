// core/test/gcal/forget.test.ts
// forgetBaseSync: clears a stale sync entry under the sync lock.
import { test, expect, beforeEach } from 'bun:test'
import { existsSync } from 'node:fs'
import { tempDir } from '../helpers'
import {
    readManifest,
    writeManifest,
    manifestKey,
    gcalDir,
    forgetBaseSync,
} from '../../src/gcal/manifest'
import { withSyncLock, SyncLocked } from '../../src/gcal/lock'

let home: string
let vault: string
beforeEach(() => {
    home = tempDir('bismuth-forget-home-')
    vault = tempDir('bismuth-forget-vault-')
})

const entry = { links: { g1: { bismuthId: 'e1' } } }

test('removes the namespaced key and leaves the others', async () => {
    writeManifest(
        {
            bases: {
                [manifestKey(vault, 'Cal.base.jsonl')]: entry,
                [manifestKey(vault, 'Other.md')]: entry,
            },
        },
        home,
    )
    expect(await forgetBaseSync(vault, './Cal.base.jsonl/', { home })).toBe(
        true,
    )
    const keys = Object.keys(readManifest(home).bases)
    expect(keys).toEqual([manifestKey(vault, 'Other.md')])
})

test('the bare legacy key goes only with claimLegacy', async () => {
    writeManifest({ bases: { 'Cal.md': entry } }, home)
    expect(await forgetBaseSync(vault, 'Cal.md', { home })).toBe(false)
    expect(Object.keys(readManifest(home).bases)).toEqual(['Cal.md'])
    expect(await forgetBaseSync(vault, 'Cal.md', { home, claimLegacy: true })).toBe(
        true,
    )
    expect(readManifest(home).bases).toEqual({})
})

test('no manifest: false and no gcal dir created', async () => {
    expect(await forgetBaseSync(vault, 'Cal.md', { home })).toBe(false)
    expect(existsSync(gcalDir(home))).toBe(false)
})

test('a missing entry returns false', async () => {
    writeManifest({ bases: { [manifestKey(vault, 'A.md')]: entry } }, home)
    expect(await forgetBaseSync(vault, 'B.md', { home })).toBe(false)
})

test('throws SyncLocked while the lock is held', async () => {
    writeManifest({ bases: { [manifestKey(vault, 'A.md')]: entry } }, home)
    await withSyncLock(async () => {
        await expect(forgetBaseSync(vault, 'A.md', { home })).rejects.toBeInstanceOf(
            SyncLocked,
        )
    }, home)
    expect(Object.keys(readManifest(home).bases)).toHaveLength(1)
})
