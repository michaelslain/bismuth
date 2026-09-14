import { test, expect, spyOn } from 'bun:test'
import { createLayoutRunner, runLayoutJob } from '../src/layoutRunner'
import { computeLayoutPair } from '../src/layoutCompute'

const job = () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}` }))
    const edges = nodes.slice(1).map((n, i) => ({ from: `n${Math.floor(i / 3)}`, to: n.id }))
    return { input: { nodes, edges }, refineTicks: 60 }
}

test('worker output is byte-identical to in-process output', async () => {
    const inProcess = await computeLayoutPair(job())
    const viaWorker = await runLayoutJob(job())
    expect(viaWorker).toEqual(inProcess)
})

// What a settle on the request thread actually did was STARVE other work rather than stall it: each 8 ms
// yield hands the rest of the loop one short turn before the next slice (on the vault clone, listTree got
// ~1 % of the CPU). A competing task shaped like a request handler — a little CPU, then a macrotask yield —
// is measured against its own idle rate: during an in-process settle it ran at 0.028 of it, during a
// worker settle at 0.997–1.001.
test('other work keeps its throughput while a worker settles', async () => {
    const stepsPerMs = async (until: Promise<unknown>) => {
        let done = false
        void until.then(() => {
            done = true
        })
        let steps = 0
        const t0 = performance.now()
        while (!done) {
            const end = performance.now() + 0.25
            while (performance.now() < end) {}
            await new Promise<void>(r => setImmediate(r))
            steps++
        }
        return steps / (performance.now() - t0)
    }
    const idle = await stepsPerMs(new Promise(r => setTimeout(r, 300)))
    const big = job()
    big.refineTicks = 240
    const during = await stepsPerMs(runLayoutJob(big))
    expect(during / idle).toBeGreaterThan(0.5)
})

test('aborting a running job rejects it and the next job still completes', async () => {
    const ac = new AbortController()
    const big = job()
    big.refineTicks = 240
    const p = runLayoutJob(big, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(await runLayoutJob(job())).toEqual(await computeLayoutPair(job()))
})

test('aborting a queued job rejects it without disturbing the job ahead of it', async () => {
    const ahead = runLayoutJob(job())
    const ac = new AbortController()
    const queued = runLayoutJob(job(), ac.signal)
    ac.abort()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(await ahead).toEqual(await computeLayoutPair(job()))
})

test('a job that cannot be sent to the worker rejects and the queue keeps moving', async () => {
    const runner = createLayoutRunner(
        new URL('../src/layoutWorker.ts', import.meta.url).href,
    )
    const unsendable = job()
    ;(unsendable.input.nodes[0] as Record<string, unknown>).fn = () => 0
    await expect(runner.run(unsendable)).rejects.toMatchObject({
        name: 'DataCloneError',
    })
    expect(await runner.run(job())).toEqual(await computeLayoutPair(job()))
})

// Bun does not throw from `new Worker` when the worker file is missing (a compiled binary built without
// the worker entrypoint): it fires `error` and `close` later. Every job must still settle, in-process.
test('a worker that cannot load falls back to in-process output and logs once', async () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
        const runner = createLayoutRunner(
            new URL('./no-such-layout-worker.ts', import.meta.url).href,
        )
        const expected = await computeLayoutPair(job())
        const [a, b] = await Promise.all([runner.run(job()), runner.run(job())])
        expect(a).toEqual(expected)
        expect(b).toEqual(expected)
        expect(await runner.run(job())).toEqual(expected)
        const logged = warn.mock.calls.filter(c =>
            String(c[0]).startsWith(
                '[layout] worker unavailable, computing in-process: ',
            ),
        )
        expect(logged.length).toBe(1)
    } finally {
        warn.mockRestore()
    }
})
