// core/test/routes/book.test.ts — POST /transcribe + GET /transcript. The engines are
// swapped through setTranscribeEngines; no test spawns the real helper or an agent.
import { test, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from '../../src/server'
import { AUTO_AI_BELOW, setTranscribeEngines as setEngines, type TranscribeEngines } from '../../src/transcribe'
import { AppError } from '../../src/error'
import { TRANSCRIPT_START } from '../../src/transcript'
import { readRunRecords } from '../../src/runRegistry'
import { makeVault, tempDir } from '../helpers'

process.env.BISMUTH_RUN_DIR = tempDir('bismuth-book-run-')

// An engine a test does not stub answers unavailable, as on a machine with neither engine. Without
// this, `auto` (the settings default) falls through to the real ai engine and runs a real agent turn.
const NO_ENGINES: TranscribeEngines = {
    onDevice: async () => {
        throw new AppError('VISION_UNAVAILABLE', 'no helper in tests', 503)
    },
    ai: async () => {
        throw new AppError('AI_UNAVAILABLE', 'no ai backend in tests', 503)
    },
    marker: async () => {
        throw new AppError('MARKER_UNAVAILABLE', 'no marker in tests', 503)
    },
    lines: async () => {
        throw new AppError('VISION_UNAVAILABLE', 'no helper in tests', 503)
    },
}

const setTranscribeEngines = (engines: Partial<TranscribeEngines> | null) => setEngines({ ...NO_ENGINES, ...engines })

beforeEach(() => setTranscribeEngines(null))
afterEach(() => setEngines(null))

const PNG = 'png-bytes'

async function withServer(files: Record<string, string>, fn: (base: string, vault: string, token: string) => Promise<void>) {
    const vault = makeVault(files)
    const server = createServer({ vault, port: 0 })
    try {
        const token = readRunRecords().find(r => r.vault === vault)?.token ?? ''
        await fn(`http://localhost:${server.port}`, vault, token)
    } finally {
        server.stop(true)
    }
}

const post = (base: string, token: string, body: unknown) =>
    fetch(`${base}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'X-Bismuth-Token': token } : {}) },
        body: JSON.stringify(body),
    })

test('pages-limited run keeps the other pages of the transcript', async () => {
    setTranscribeEngines({
        onDevice: async () => [
            { page: 1, text: 'one' },
            { page: 2, text: 'two' },
            { page: 3, text: 'three' },
        ],
    })
    await withServer({ 'a.pdf': PNG }, async (base, _vault, token) => {
        expect((await post(base, token, { file: 'a.pdf', engine: 'on-device' })).status).toBe(200)
        setTranscribeEngines({ ai: async () => [{ page: 2, text: 'TWO' }] })
        const res = await post(base, token, { file: 'a.pdf', engine: 'ai', pages: [2] })
        expect((await res.json()).pages).toEqual([{ page: 2, chars: 3 }])
        const got = await (await fetch(`${base}/transcript?file=a.pdf`, { headers: { 'X-Bismuth-Token': token } })).json()
        expect(got.pages).toEqual([
            { page: 1, text: 'one' },
            { page: 2, text: 'TWO' },
            { page: 3, text: 'three' },
        ])
    })
})

test('on-device transcribe writes the marked block into a.png.md', async () => {
    const calls: string[] = []
    setTranscribeEngines({
        onDevice: async abs => {
            calls.push(abs)
            return [{ page: 1, text: 'hello page' }]
        },
    })
    await withServer({ 'a.png': PNG }, async (base, vault, token) => {
        const res = await post(base, token, { file: 'a.png', engine: 'on-device' })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            ok: true,
            companion: 'a.png.md',
            engine: 'on-device',
            pages: [{ page: 1, chars: 10 }],
        })
        expect(calls).toEqual([join(vault, 'a.png')])
        const md = readFileSync(join(vault, 'a.png.md'), 'utf8')
        expect(md).toContain(TRANSCRIPT_START)
        expect(md).toContain('hello page')
        expect(md).toContain('transcribed: on-device')
        const got = await (await fetch(`${base}/transcript?file=a.png`, { headers: { 'X-Bismuth-Token': token } })).json()
        expect(got.engine).toBe('on-device')
        expect(typeof got.at).toBe('string')
        expect(got.pages).toEqual([{ page: 1, text: 'hello page' }])
    })
})

test('engine ai runs the ai engine and a book is filed in the companion', async () => {
    setTranscribeEngines({ ai: async () => [{ page: 1, text: 'from ai' }] })
    await withServer({ 'a.png': PNG }, async (base, vault, token) => {
        const res = await post(base, token, { file: 'a.png', engine: 'ai', book: 'Notebook' })
        expect(res.status).toBe(200)
        const md = readFileSync(join(vault, 'a.png.md'), 'utf8')
        expect(md).toContain('transcribed: ai')
        expect(md).toContain('[[Notebook]]')
    })
})

test('onlyMissing skips a page that already carries a transcript', async () => {
    let runs = 0
    setTranscribeEngines({ onDevice: async () => (runs++, [{ page: 1, text: 'once' }]) })
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        await post(base, token, { file: 'a.png' })
        const res = await post(base, token, { file: 'a.png', onlyMissing: true })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ ok: true, companion: 'a.png.md', skipped: true, pages: [] })
        expect(runs).toBe(1)
    })
})

test('a note is 422, a missing file is 404', async () => {
    await withServer({ 'notes.md': '# n\n' }, async (base, _vault, token) => {
        expect((await post(base, token, { file: 'notes.md' })).status).toBe(422)
        expect((await post(base, token, { file: 'gone.png' })).status).toBe(404)
        expect((await post(base, token, { file: '../x.png' })).status).toBe(400)
    })
})

test('an unavailable engine answers 503', async () => {
    let aiRuns = 0
    setTranscribeEngines({
        onDevice: async () => {
            throw new AppError('VISION_UNAVAILABLE', 'no helper', 503)
        },
        ai: async () => {
            aiRuns++
            throw new AppError('AI_UNAVAILABLE', 'no ai backend', 503)
        },
    })
    await withServer({ 'a.png': PNG }, async (base, vault, token) => {
        // the requested engine alone
        expect((await post(base, token, { file: 'a.png', engine: 'on-device' })).status).toBe(503)
        expect((await post(base, token, { file: 'a.png', engine: 'ai' })).status).toBe(503)
        // auto (the default) with no on-device helper tries ai, and ai is unavailable too
        expect((await post(base, token, { file: 'a.png' })).status).toBe(503)
        expect(aiRuns).toBe(2)
        expect(await Bun.file(join(vault, 'a.png.md')).exists()).toBe(false)
    })
})

test('a hidden page is 403 for a restricted caller on both routes and works for the owner', async () => {
    setTranscribeEngines({ onDevice: async () => [{ page: 1, text: 'secret text' }] })
    await withServer(
        { 'h.png': PNG, 'h.png.md': '---\nvisibility: hidden\n---\n' },
        async (base, _vault, token) => {
            expect((await post(base, '', { file: 'h.png' })).status).toBe(403)
            expect((await fetch(`${base}/transcript?file=h.png`)).status).toBe(403)
            expect((await post(base, token, { file: 'h.png' })).status).toBe(200)
        },
    )
})

test('GET /transcript is empty for a page with no transcript', async () => {
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        const res = await fetch(`${base}/transcript?file=a.png`, { headers: { 'X-Bismuth-Token': token } })
        expect(await res.json()).toEqual({ pages: [] })
    })
})

const postTo = (base: string, token: string, path: string, body: unknown) =>
    fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'X-Bismuth-Token': token } : {}) },
        body: JSON.stringify(body),
    })

test('POST /transcript/mark marks and unmarks a quote in the page transcript', async () => {
    setTranscribeEngines({ onDevice: async () => [{ page: 1, text: 'one' }, { page: 2, text: 'buy milk' }] })
    await withServer({ 'a.pdf': PNG }, async (base, vault, token) => {
        await post(base, token, { file: 'a.pdf' })
        const res = await postTo(base, token, '/transcript/mark', { file: 'a.pdf', page: 2, add: ['milk', 'nope'] })
        expect(await res.json()).toEqual({ ok: true, companion: 'a.pdf.md', marks: ['milk'] })
        expect(readFileSync(join(vault, 'a.pdf.md'), 'utf8')).toContain('buy ==milk==')
        const back = await postTo(base, token, '/transcript/mark', { file: 'a.pdf', page: 2, remove: ['milk'] })
        expect((await back.json()).marks).toEqual([])
        expect(readFileSync(join(vault, 'a.pdf.md'), 'utf8')).toContain('buy milk')
    })
})

test('POST /transcript/mark: no transcript is 404, a hidden page is 403', async () => {
    await withServer(
        { 'a.png': PNG, 'h.png': PNG, 'h.png.md': '---\nvisibility: hidden\n---\n' },
        async (base, _vault, token) => {
            expect((await postTo(base, token, '/transcript/mark', { file: 'a.png', add: ['x'] })).status).toBe(404)
            expect((await postTo(base, '', '/transcript/mark', { file: 'h.png', add: ['x'] })).status).toBe(403)
        },
    )
})

test('POST /transcript/lines returns the engine lines and 503 when unavailable', async () => {
    const lines = [{ text: 'hi', x: 0.1, y: 0.2, w: 0.3, h: 0.05 }]
    setTranscribeEngines({ lines: async () => [{ page: 1, lines }] })
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        const res = await postTo(base, token, '/transcript/lines', { file: 'a.png' })
        expect(await res.json()).toEqual({ pages: [{ page: 1, lines }] })
        setTranscribeEngines({
            lines: async () => {
                const { AppError } = await import('../../src/error')
                throw new AppError('VISION_UNAVAILABLE', 'no helper', 503)
            },
        })
        expect((await postTo(base, token, '/transcript/lines', { file: 'a.png' })).status).toBe(503)
        expect((await postTo(base, token, '/transcript/lines', { file: 'gone.png' })).status).toBe(404)
    })
})

test('auto keeps confident pages and re-runs blank and low-confidence pages with ai', async () => {
    const asked: (number[] | undefined)[] = []
    setTranscribeEngines({
        onDevice: async () => [
            { page: 1, text: 'sure', confidence: 0.9 },
            { page: 2, text: 'smudge', confidence: AUTO_AI_BELOW - 0.1 },
            { page: 3, text: '', confidence: 0.9 },
        ],
        ai: async (_abs, _kind, pages) => {
            asked.push(pages)
            return [
                { page: 2, text: 'smudged words' },
                { page: 3, text: 'hidden words' },
            ]
        },
    })
    await withServer({ 'a.pdf': PNG }, async (base, vault, token) => {
        const res = await post(base, token, { file: 'a.pdf', engine: 'auto' })
        expect(await res.json()).toMatchObject({ engine: 'ai', escalated: [2, 3] })
        expect(asked).toEqual([[2, 3]])
        const md = readFileSync(join(vault, 'a.pdf.md'), 'utf8')
        expect(md).toContain('sure')
        expect(md).toContain('smudged words')
        expect(md).not.toContain('smudge\n')
    })
})

test('auto keeps the on-device text when ai is unavailable and says why', async () => {
    setTranscribeEngines({
        onDevice: async () => [{ page: 1, text: 'faint', confidence: 0.1 }],
        ai: async () => {
            throw new AppError('AI_UNAVAILABLE', 'ai transcription needs a backend that reads images: x does not', 503)
        },
    })
    await withServer({ 'a.png': PNG }, async (base, vault, token) => {
        const res = await post(base, token, { file: 'a.png', engine: 'auto' })
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.engine).toBe('on-device')
        expect(body.escalated).toBeUndefined()
        expect(body.aiSkipped).toContain('reads images')
        expect(readFileSync(join(vault, 'a.png.md'), 'utf8')).toContain('faint')
    })
})

test('a request without engine uses transcription.engine and passes provider and model', async () => {
    const targets: unknown[] = []
    setTranscribeEngines({
        onDevice: async () => [{ page: 1, text: 'device' }],
        ai: async (_abs, _kind, _pages, target) => {
            targets.push(target)
            return [{ page: 1, text: 'agent' }]
        },
    })
    await withServer(
        {
            'a.png': PNG,
            '.settings': 'transcription:\n  engine: ai\n  provider: opencode\n  model: m1\nchat:\n  provider: codex\n',
        },
        async (base, vault, token) => {
            const res = await post(base, token, { file: 'a.png' })
            expect(await res.json()).toMatchObject({ engine: 'ai' })
            expect(targets).toEqual([{ provider: 'opencode', model: 'm1', chatProvider: 'codex' }])
            expect(readFileSync(join(vault, 'a.png.md'), 'utf8')).toContain('transcribed: ai')
        },
    )
})

test('an unknown engine is 400', async () => {
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        expect((await post(base, token, { file: 'a.png', engine: 'bogus' })).status).toBe(400)
    })
})

// On-device text of a handwritten limit proof: confident, and garbled.
const GARBLED_MATH = ['Limit', "Sn't S= (1) doint converge", 'lim s n', 'n5-6 =nsa', 'IN#6NnZN 1351-515'].join('\n')
const PROSE = ['Dear diary,', 'we walked to the lake', 'and talked about the trip', 'then home for dinner'].join('\n')

test('auto re-reads a page that looks like math with marker and keeps the prose page', async () => {
    const asked: (number[] | undefined)[] = []
    setTranscribeEngines({
        onDevice: async () => [
            { page: 1, text: PROSE, confidence: 0.9 },
            { page: 2, text: GARBLED_MATH, confidence: 0.8 },
        ],
        marker: async (_abs, _kind, pages) => {
            asked.push(pages)
            return [{ page: 2, text: '$\\lim_{n\\to\\infty} s_n = s$' }]
        },
    })
    await withServer({ 'a.pdf': PNG }, async (base, vault, token) => {
        const body = await (await post(base, token, { file: 'a.pdf', engine: 'auto' })).json()
        expect(body).toMatchObject({ engine: 'marker', escalated: [2] })
        expect(body.math).toBeUndefined()
        expect(asked).toEqual([[2]])
        const md = readFileSync(join(vault, 'a.pdf.md'), 'utf8')
        expect(md).toContain('transcribed: marker')
        expect(md).toContain('we walked to the lake')
        expect(md).toContain('$\\lim_{n\\to\\infty} s_n = s$')
        expect(md).not.toContain('doint converge')
    })
})

test('math fast keeps the on-device text and lists the math pages, by request or by setting', async () => {
    let markerRuns = 0
    setTranscribeEngines({
        onDevice: async () => [
            { page: 1, text: PROSE, confidence: 0.9 },
            { page: 2, text: GARBLED_MATH, confidence: 0.8 },
        ],
        marker: async () => {
            markerRuns++
            return []
        },
    })
    await withServer({ 'a.pdf': PNG, 'b.pdf': PNG, '.settings': 'transcription:\n  math: fast\n' }, async (base, vault, token) => {
        const byRequest = await (await post(base, token, { file: 'a.pdf', engine: 'auto', math: 'fast' })).json()
        expect(byRequest).toMatchObject({ engine: 'on-device', math: [2] })
        const bySetting = await (await post(base, token, { file: 'b.pdf', engine: 'auto' })).json()
        expect(bySetting).toMatchObject({ engine: 'on-device', math: [2] })
        expect(markerRuns).toBe(0)
        expect(readFileSync(join(vault, 'a.pdf.md'), 'utf8')).toContain('doint converge')
    })
})

test('a math page goes to ai when marker cannot run, and says why', async () => {
    const asked: (number[] | undefined)[] = []
    setTranscribeEngines({
        onDevice: async () => [{ page: 1, text: GARBLED_MATH, confidence: 0.8 }],
        ai: async (_abs, _kind, pages) => {
            asked.push(pages)
            return [{ page: 1, text: '$s = s\'$' }]
        },
    })
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        const body = await (await post(base, token, { file: 'a.png', engine: 'auto', math: 'careful' })).json()
        expect(body).toMatchObject({ engine: 'ai', escalated: [1] })
        expect(body.markerSkipped).toBe('no marker in tests')
        expect(asked).toEqual([[1]])
    })
})

test('engine marker reads the asked pages with marker alone', async () => {
    const asked: (number[] | undefined)[] = []
    setTranscribeEngines({
        marker: async (_abs, _kind, pages) => {
            asked.push(pages)
            return [{ page: 3, text: '$$x^2$$' }]
        },
    })
    await withServer({ 'a.pdf': PNG }, async (base, vault, token) => {
        expect(await (await post(base, token, { file: 'a.pdf', engine: 'marker', pages: [3] })).json()).toMatchObject({ engine: 'marker' })
        expect(asked).toEqual([[3]])
        expect(readFileSync(join(vault, 'a.pdf.md'), 'utf8')).toContain('$$x^2$$')
    })
})

test('an unknown math choice is 400', async () => {
    await withServer({ 'a.png': PNG }, async (base, _vault, token) => {
        expect((await post(base, token, { file: 'a.png', math: 'ask' })).status).toBe(400)
    })
})

test('the math reader setup routes answer the owner only, and a start runs the install job', async () => {
    const { setMarkerSetupSteps } = await import('../../src/markerSetup')
    const saved = process.env.BISMUTH_TOOLS_DIR
    process.env.BISMUTH_TOOLS_DIR = tempDir('setup-route-tools-')
    // the steps never touch the network; the install is already "there" once marker runs
    setMarkerSetupSteps({ uv: async () => 'uv', marker: async () => {}, llama: async () => {} })
    try {
        await withServer({}, async (base, _vault, token) => {
            const auth = { 'X-Bismuth-Token': token }
            expect((await fetch(`${base}/transcribe/setup`)).status).toBe(403)
            expect((await fetch(`${base}/transcribe/setup`, { method: 'POST' })).status).toBe(403)
            const status = await (await fetch(`${base}/transcribe/setup`, { headers: auth })).json()
            expect(typeof status.installed).toBe('boolean')
            expect(Array.isArray(status.missing)).toBe(true)
            const started = await (await fetch(`${base}/transcribe/setup`, { method: 'POST', headers: auth })).json()
            expect(['running', 'done']).toContain(started.state)
        })
    } finally {
        setMarkerSetupSteps(null)
        if (saved === undefined) delete process.env.BISMUTH_TOOLS_DIR
        else process.env.BISMUTH_TOOLS_DIR = saved
    }
})
