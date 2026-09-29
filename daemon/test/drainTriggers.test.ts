import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listTriggers, consumeTrigger } from '../src/lib/drainTriggers'

async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), 'drain-'))
    try {
        await fn(dir)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

test('missing or empty dir returns []', async () => {
    expect(await listTriggers('/nonexistent/x', async () => true)).toEqual([])
    await withDir(async dir => {
        await writeFile(join(dir, '.hidden'), '')
        expect(await listTriggers(dir, async () => true)).toEqual([])
        expect(await readdir(dir)).toEqual(['.hidden'])
    })
})

test('not owner: unlinks every trigger and returns []', async () => {
    await withDir(async dir => {
        await writeFile(join(dir, 'a'), '')
        await writeFile(join(dir, 'b'), '')
        await writeFile(join(dir, '.keep'), '')
        expect(await listTriggers(dir, async () => false)).toEqual([])
        expect(await readdir(dir)).toEqual(['.keep'])
    })
})

test('owner: returns names and leaves them on disk', async () => {
    await withDir(async dir => {
        await writeFile(join(dir, 'a'), '')
        await writeFile(join(dir, 'b'), '')
        const got = await listTriggers(dir, async () => true)
        expect(got.sort()).toEqual(['a', 'b'])
        expect((await readdir(dir)).sort()).toEqual(['a', 'b'])
    })
})

test('consumeTrigger unlinks one trigger and tolerates a missing one', async () => {
    await withDir(async dir => {
        await writeFile(join(dir, 'a'), '')
        await writeFile(join(dir, 'b'), '')
        await consumeTrigger(dir, 'a')
        await consumeTrigger(dir, 'nope')
        expect(await readdir(dir)).toEqual(['b'])
    })
})
