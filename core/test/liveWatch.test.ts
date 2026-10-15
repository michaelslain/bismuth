import { test, expect } from 'bun:test'
import { mkdirSync, readdirSync, rmSync, writeFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { watchLive } from '../src/liveWatch'
import { tempDir } from './tempDirs'

type Cb = (event: string, filename: string | null) => void

/** A watcher that reports nothing until the test says the stream is live — the startup gap,
 *  made deterministic. */
function fakeWatch() {
    const cbs = new Map<string, Cb>()
    let closed = 0
    const watchFn = ((root: string, _opts: unknown, cb: Cb) => {
        cbs.set(root, cb)
        return { close: () => closed++ }
    }) as unknown as typeof watch
    const probeOf = (root: string) =>
        readdirSync(root).find(n => n.startsWith('.bismuth-watch-probe-'))
    return {
        watchFn,
        emit: (root: string, filename: string | null) =>
            cbs.get(root)!('rename', filename),
        goLive: (root: string) => cbs.get(root)!('change', probeOf(root)!),
        probeOf,
        closed: () => closed,
    }
}

const tick = () => new Promise(r => setTimeout(r, 5))

async function until(cond: () => boolean, ms = 5000) {
    const deadline = Date.now() + ms
    while (!cond() && Date.now() < deadline) await tick()
}

async function settle(root: string, fake: ReturnType<typeof fakeWatch>) {
    const deadline = Date.now() + 2000
    while (fake.probeOf(root) && Date.now() < deadline) await tick()
    await new Promise(r => setTimeout(r, 50))
}

test('a change made before the watch is live is reported once it is', async () => {
    const root = tempDir('live-watch-')
    writeFileSync(join(root, 'edited.md'), 'old')
    writeFileSync(join(root, 'untouched.md'), 'old')
    mkdirSync(join(root, 'sub'))
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    await tick()
    writeFileSync(join(root, 'edited.md'), 'new')
    writeFileSync(join(root, 'sub/created.md'), 'new')
    expect(got).toEqual([])

    fake.goLive(root)
    await settle(root, fake)
    // sub/'s mtime moved, but created.md accounts for it — no extent-unknown report.
    expect(got.sort()).toEqual(['edited.md', 'sub/created.md'])
    w.close()
})

test('nothing changed during startup → catch-up reports nothing and removes the probe', async () => {
    const root = tempDir('live-watch-')
    writeFileSync(join(root, 'a.md'), 'x')
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    expect(fake.probeOf(root)).toBeDefined()
    fake.goLive(root)
    await settle(root, fake)
    expect(got).toEqual([])
    expect(fake.probeOf(root)).toBeUndefined()
    w.close()
})

test('a path the watcher already reported is not reported again by catch-up', async () => {
    const root = tempDir('live-watch-')
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    await tick()
    writeFileSync(join(root, 'b.md'), 'x')
    fake.emit(root, 'b.md')
    fake.goLive(root)
    await settle(root, fake)
    expect(got).toEqual(['b.md'])
    w.close()
})

test('a delete during startup, which no stat can name, is reported as extent-unknown', async () => {
    const root = tempDir('live-watch-')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub/gone.md'), 'x')
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    await tick()
    rmSync(join(root, 'sub/gone.md'))
    fake.goLive(root)
    await settle(root, fake)
    expect(got).toEqual([null])
    w.close()
})

test('skipDir keeps a directory out of the catch-up walk', async () => {
    const root = tempDir('live-watch-')
    mkdirSync(join(root, '.git'))
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), {
        watchFn: fake.watchFn,
        skipDir: rel => rel === '.git',
    })
    await tick()
    writeFileSync(join(root, '.git/index'), 'x')
    fake.goLive(root)
    await settle(root, fake)
    expect(got).toEqual([])
    w.close()
})

test("a nested watcher's probe is neither an event nor a lost child to the outer one", async () => {
    const root = tempDir('live-watch-')
    const inner = join(root, 'memory')
    mkdirSync(inner)
    const fake = fakeWatch()
    const outer: (string | null)[] = []
    const o = watchLive(root, f => outer.push(f), { watchFn: fake.watchFn })
    await tick()
    // The inner watcher creates its probe inside the outer root, then removes it once live.
    const i = watchLive(inner, () => {}, { watchFn: fake.watchFn })
    fake.emit(root, `memory/${fake.probeOf(inner)}`)
    fake.goLive(inner)
    await settle(inner, fake)
    fake.goLive(root)
    await settle(root, fake)
    expect(outer).toEqual([])
    i.close()
    o.close()
})

test('close() before the watch is live stops probing and removes the probe', () => {
    const root = tempDir('live-watch-')
    const fake = fakeWatch()
    const w = watchLive(root, () => {}, { watchFn: fake.watchFn })
    expect(fake.probeOf(root)).toBeDefined()
    w.close()
    expect(fake.probeOf(root)).toBeUndefined()
    expect(fake.closed()).toBe(1)
})

test('with the real fs.watch, a write made the moment watchLive returns is reported', async () => {
    const root = tempDir('live-watch-')
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f))
    writeFileSync(join(root, 'b.md'), 'x')
    try {
        const deadline = Date.now() + 5000
        while (!got.includes('b.md') && Date.now() < deadline) await tick()
        expect(got).toContain('b.md')
    } finally {
        w.close()
    }
})

test('a write dropped while a sibling watcher opens or closes is still delivered', async () => {
    const root = tempDir('live-watch-')
    const other = tempDir('live-watch-')
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    fake.goLive(root)
    await settle(root, fake)
    expect(got).toEqual([])

    // The sibling's open drops this write: it is on disk, the watcher never reports it.
    const sib = watchLive(other, () => {}, { watchFn: fake.watchFn })
    writeFileSync(join(root, 'dropped-on-open.md'), 'x')
    fake.goLive(other)
    await settle(other, fake)
    await until(() => got.length >= 1)
    expect(got).toEqual(['dropped-on-open.md'])

    // And so does its close.
    writeFileSync(join(root, 'dropped-on-close.md'), 'x')
    sib.close()
    await until(() => got.length >= 2)
    expect(got.sort()).toEqual(['dropped-on-close.md', 'dropped-on-open.md'])

    // A path already reported is not reported again by the next rescan.
    writeFileSync(join(root, 'seen.md'), 'x')
    fake.emit(root, 'seen.md')
    const sib2 = watchLive(other, () => {}, { watchFn: fake.watchFn })
    await new Promise(r => setTimeout(r, 600))
    expect(got.filter(f => f === 'seen.md')).toHaveLength(1)
    sib2.close()
    w.close()
})

test('a disjoint sibling opened just after going live does not make a rescan report anything', async () => {
    const root = tempDir('live-watch-')
    const other = tempDir('live-watch-')
    writeFileSync(join(root, 'a.md'), 'x')
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    fake.goLive(root)
    await settle(root, fake)
    await new Promise(r => setTimeout(r, 60))
    const sib = watchLive(other, () => {}, { watchFn: fake.watchFn })
    fake.goLive(other)
    await new Promise(r => setTimeout(r, 700))
    expect(got).toEqual([])
    sib.close()
    w.close()
})

test('a sibling opened inside the root long after going live does not read as a lost child', async () => {
    const root = tempDir('live-watch-')
    mkdirSync(join(root, 'inner'))
    const fake = fakeWatch()
    const got: (string | null)[] = []
    const w = watchLive(root, f => got.push(f), { watchFn: fake.watchFn })
    fake.goLive(root)
    await settle(root, fake)
    await new Promise(r => setTimeout(r, 600))
    const sib = watchLive(join(root, 'inner'), () => {}, { watchFn: fake.watchFn })
    fake.goLive(join(root, 'inner'))
    await new Promise(r => setTimeout(r, 700))
    expect(got).toEqual([])
    sib.close()
    w.close()
})
