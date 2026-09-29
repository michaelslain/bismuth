import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { drainTriggers } from '../src/lib/drainTriggers'

async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'drain-'))
    try {
        await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

test('missing or empty dir returns []', async () => {
    expect(await drainTriggers('/nonexistent/x', async () => true)).toEqual([])
    await withDir(async dir => {
        await writeFile(join(dir, '.hidden'), '')
        expect(await drainTriggers(dir, async () => true)).toEqual([])
        expect(await readdir(dir)).toEqual(['.hidden'])
    })
})

test('not owner: unlinks every trigger and returns []', async () => {
    await withDir(async dir => {
        await writeFile(join(dir, 'a'), '')
        await writeFile(join(dir, 'b'), '')
        await writeFile(join(dir, '.keep'), '')
        expect(await drainTriggers(dir, async () => false)).toEqual([])
        expect(await readdir(dir)).toEqual(['.keep'])
    })
})

test('owner: returns names and unlinks them', async () => {
    await withDir(async dir => {
        await writeFile(join(dir, 'a'), '')
        await writeFile(join(dir, 'b'), '')
        const got = await drainTriggers(dir, async () => true)
        expect(got.sort()).toEqual(['a', 'b'])
        expect(await readdir(dir)).toEqual([])
    })
})
