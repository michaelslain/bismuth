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
