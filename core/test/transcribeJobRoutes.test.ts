// core/test/transcribeJobRoutes.test.ts — the four /transcribe/job routes against a real server,
// and the in-process (iPad) backend's answers. Engines are faked.
import { afterEach, expect, test } from 'bun:test'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createServer } from '../src/server'
import { createLocalBackend } from '../src/localBackend'
import { setTranscribeEngines } from '../src/transcribe'
import { resetTranscribeJobs, transcribeJobSettled } from '../src/transcribeJob'
import { readRunRecords } from '../src/runRegistry'
import { makeVault, tempDir } from './helpers'

process.env.BISMUTH_RUN_DIR = tempDir('bismuth-transcribejob-run-')

afterEach(() => {
    resetTranscribeJobs()
    setTranscribeEngines(null)
})

async function withServer(files: Record<string, string>, fn: (api: {
    get: (path: string, restricted?: boolean) => Promise<Response>
    post: (path: string, body: unknown, restricted?: boolean) => Promise<Response>
}, vault: string) => Promise<void>) {
    const vault = makeVault(files)
    const doc = await PDFDocument.create()
    doc.addPage([100, 100])
    doc.addPage([100, 100])
    writeFileSync(join(vault, 'p.pdf'), await doc.save())
    const server = createServer({ vault, port: 0 })
    try {
        const token = readRunRecords().find(r => r.vault === vault)?.token ?? ''
        const headers = (restricted?: boolean) => ({
            'content-type': 'application/json',
            ...(token && !restricted ? { 'X-Bismuth-Token': token } : {}),
        })
        const url = (p: string) => `http://localhost:${server.port}${p}`
        await fn(
            {
                get: (p, r) => fetch(url(p), { headers: headers(r) }),
                post: (p, body, r) => fetch(url(p), { method: 'POST', headers: headers(r), body: JSON.stringify(body) }),
            },
            vault,
        )
    } finally {
        server.stop(true)
    }
}

test('start answers the job at once, GET follows it, the pages land in the transcript', async () => {
    setTranscribeEngines({ onDevice: async (_a, _k, p) => [{ page: p![0], text: `t${p![0]}`, confidence: 0.9 }] })
    await withServer({}, async api => {
        expect((await (await api.get('/transcribe/job?file=p.pdf')).json())).toBeNull()
        const start = await api.post('/transcribe/job', { file: 'p.pdf', engine: 'on-device' })
        expect(start.status).toBe(200)
        expect((await start.json()).state).toBe('running')
        await transcribeJobSettled('p.pdf')
        const job = await (await api.get('/transcribe/job?file=p.pdf')).json()
        expect(job.state).toBe('done')
        expect(job.pages.map((p: { status: string }) => p.status)).toEqual(['done', 'done'])
        const t = await (await api.get('/transcript?file=p.pdf')).json()
        expect(t.pages.map((p: { text: string }) => p.text)).toEqual(['t1', 't2'])
    })
})

test('cancel and math answer the job, and 404 when the file has none', async () => {
    setTranscribeEngines({ onDevice: async (_a, _k, p) => [{ page: p![0], text: 'x = 1\ny = 2\nz > 3', confidence: 0.9 }] })
    await withServer({}, async api => {
        expect((await api.post('/transcribe/job/cancel', { file: 'p.pdf' })).status).toBe(404)
        expect((await api.post('/transcribe/job/math', { file: 'p.pdf', choice: 'fast' })).status).toBe(404)
        await api.post('/transcribe/job', { file: 'p.pdf', engine: 'auto', math: 'ask' })
        await transcribeJobSettled('p.pdf')
        const fast = await (await api.post('/transcribe/job/math', { file: 'p.pdf', choice: 'fast' })).json()
        expect(fast.mathPending).toEqual([])
        const cancelled = await (await api.post('/transcribe/job/cancel', { file: 'p.pdf' })).json()
        expect(cancelled.file).toBe('p.pdf')
    })
})

test('a bad file or a body without one is refused', async () => {
    await withServer({}, async api => {
        expect((await api.post('/transcribe/job', { file: '../x.pdf' })).status).toBe(400)
        expect((await api.post('/transcribe/job', { file: 'notes.md' })).status).toBe(422)
        expect((await api.get('/transcribe/job')).status).toBeGreaterThanOrEqual(400)
    })
})

test('a hidden file is forbidden to a restricted caller on all four job routes and starts nothing', async () => {
    let reads = 0
    setTranscribeEngines({
        onDevice: async (_a, _k, p) => {
            reads++
            return [{ page: p![0], text: 'x', confidence: 0.9 }]
        },
    })
    await withServer({ 'p.pdf.md': '---\nvisibility: hidden\n---\n' }, async (api, vault) => {
        // control: a restricted caller is not refused on a file that is not hidden
        copyFileSync(join(vault, 'p.pdf'), join(vault, 'q.pdf'))
        expect((await api.get('/transcribe/job?file=q.pdf', true)).status).toBe(200)
        expect((await api.get('/transcribe/job?file=p.pdf', true)).status).toBe(403)
        expect((await api.post('/transcribe/job', { file: 'p.pdf', engine: 'on-device' }, true)).status).toBe(403)
        expect((await api.post('/transcribe/job/cancel', { file: 'p.pdf' }, true)).status).toBe(403)
        expect((await api.post('/transcribe/job/math', { file: 'p.pdf', choice: 'fast' }, true)).status).toBe(403)
        await transcribeJobSettled('p.pdf')
        expect(reads).toBe(0)
        // the owner is not refused
        expect((await api.post('/transcribe/job', { file: 'p.pdf', engine: 'on-device' })).status).toBe(200)
        await transcribeJobSettled('p.pdf')
        expect(reads).toBe(2)
    })
})

test('the in-process backend answers the posts 503 and the get null', async () => {
    const be = createLocalBackend({ vault: makeVault({}) } as Parameters<typeof createLocalBackend>[0])
    expect(await be.dispatch('GET', '/transcribe/job?file=p.pdf', undefined)).toBeNull()
    for (const path of ['/transcribe/job', '/transcribe/job/cancel', '/transcribe/job/math'])
        await expect(be.dispatch('POST', path, { file: 'p.pdf' })).rejects.toMatchObject({
            code: 'VISION_UNAVAILABLE',
            statusCode: 503,
        })
})
