import { expect, test } from 'bun:test'
import { createTranscribeQueue } from './transcribeQueue'

function gate() {
    let open!: () => void
    const p = new Promise<void>(r => (open = r))
    return { p, open }
}
const tick = () => new Promise(r => setTimeout(r, 0))

test('three adds run one at a time in order', async () => {
    const order: string[] = []
    let live = 0
    let peak = 0
    const gates = [gate(), gate(), gate()]
    const q = createTranscribeQueue(async file => {
        live++
        peak = Math.max(peak, live)
        order.push(file)
        await gates[order.length - 1].p
        live--
    })
    q.add('a.png')
    q.add('b.png')
    q.add('c.png')
    await tick()
    expect(order).toEqual(['a.png'])
    expect(q.snapshot()).toEqual({ done: 0, total: 3, running: 'a.png', runningCount: 1 })
    gates[0].open()
    await tick()
    expect(q.snapshot()).toEqual({ done: 1, total: 3, running: 'b.png', runningCount: 1 })
    gates[1].open()
    gates[2].open()
    await tick()
    await tick()
    expect(order).toEqual(['a.png', 'b.png', 'c.png'])
    expect(peak).toBe(1)
    expect(q.snapshot().running).toBeUndefined()
})

test('a duplicate add while queued or running is ignored', async () => {
    const seen: string[] = []
    const g = gate()
    const q = createTranscribeQueue(async file => {
        seen.push(file)
        await g.p
    })
    q.add('a.png')
    q.add('b.png')
    q.add('a.png')
    q.add('b.png')
    expect(q.snapshot().total).toBe(2)
    g.open()
    await tick()
    await tick()
    expect(seen).toEqual(['a.png', 'b.png'])
})

test('a failing run counts as done and the queue continues', async () => {
    const seen: string[] = []
    const g = gate()
    const q = createTranscribeQueue(async file => {
        seen.push(file)
        if (file === 'a.png') throw new Error('boom')
        await g.p
    })
    q.add('a.png')
    q.add('b.png')
    await tick()
    expect(seen).toEqual(['a.png', 'b.png'])
    expect(q.snapshot()).toEqual({ done: 1, total: 2, running: 'b.png', runningCount: 1 })
    g.open()
    await tick()
})

test('subscribers hear changes and can unsubscribe', async () => {
    const q = createTranscribeQueue(async () => {})
    let n = 0
    const off = q.subscribe(() => n++)
    q.add('a.png')
    await tick()
    expect(n).toBeGreaterThan(0)
    off()
    const before = n
    q.add('b.png')
    await tick()
    expect(n).toBe(before)
})

test('an automatic add passes no engine and no pages, a redo passes both', async () => {
    const jobs: unknown[] = []
    const q = createTranscribeQueue(async (_file, job) => {
        jobs.push(job)
    })
    q.add('a.png')
    await tick()
    q.add('b.png', { engine: 'ai', pages: [2] })
    await tick()
    await tick()
    expect(jobs).toEqual([{}, { engine: 'ai', pages: [2] }])
    expect('engine' in (jobs[0] as object)).toBe(false)
})

test('a job with pages counts each page, the running one included', async () => {
    const g = gate()
    const q = createTranscribeQueue(async () => {
        await g.p
    })
    q.add('a.png', { pages: [1, 2] })
    q.add('b.png')
    await tick()
    expect(q.snapshot()).toEqual({ done: 0, total: 3, running: 'a.png', runningCount: 2 })
    g.open()
    await tick()
    await tick()
    expect(q.snapshot()).toEqual({ done: 0, total: 0, running: undefined, runningCount: 0 })
})
