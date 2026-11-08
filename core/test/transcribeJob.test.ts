// core/test/transcribeJob.test.ts — the background transcription job: per-page progress, one write
// per finished page, cancel, the mid-run math choice and the one-at-a-time queue. Engines are faked.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { readFile } from 'node:fs/promises'
import { setTranscribeEngines, type TranscriptionSettings } from '../src/transcribe'
import {
    cancelTranscribeJob,
    decideTranscribeMath,
    resetTranscribeJobs,
    startTranscribeJob,
    transcribeJobSettled,
    transcribeJobState,
} from '../src/transcribeJob'
import { readTranscript } from '../src/transcript'
import { runTool } from '../src/marker'
import { makeVault } from './helpers'

const settings: TranscriptionSettings = { auto: true, engine: 'auto', math: 'ask', provider: 'auto', model: '' }
const MATH = 'x = 1\ny = 2\nz > 3'
const PROSE = 'plain words on a page'

async function pdf(root: string, name: string, n: number) {
    const doc = await PDFDocument.create()
    for (let i = 0; i < n; i++) doc.addPage([100, 100])
    writeFileSync(join(root, name), await doc.save())
}

function gate() {
    let open!: () => void
    const wait = new Promise<void>(r => (open = r))
    return { wait, open }
}

const stored = async (root: string, file: string) =>
    readTranscript(await readFile(join(root, `${file}.md`), 'utf8').catch(() => ''))

const until = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise(r => setTimeout(r, 5))
    expect(cond()).toBe(true)
}

beforeEach(() => resetTranscribeJobs())
afterEach(() => {
    resetTranscribeJobs()
    setTranscribeEngines(null)
})

describe('progress', () => {
    test('each page moves queued, reading, done on its own and is written before the next starts', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 5)
        let midRun: number[] = []
        const snapshots: string[][] = []
        setTranscribeEngines({
            onDevice: async (_abs, _kind, pages) => {
                const n = pages![0]
                snapshots.push(transcribeJobState('a.pdf')!.pages.map(p => p.status))
                if (n === 3) midRun = (await stored(root, 'a.pdf')).map(p => p.page)
                return [{ page: n, text: `${PROSE} ${n}`, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
        expect(s.pages.map(p => [p.page, p.status, p.engine])).toEqual(
            [1, 2, 3, 4, 5].map(n => [n, 'done', 'on-device']),
        )
        expect(s.pages.every(p => typeof p.ms === 'number')).toBe(true)
        expect(midRun).toEqual([1, 2])
        // while page n was being read: earlier pages done, n reading, later pages still queued
        expect(snapshots).toEqual(
            [1, 2, 3, 4, 5].map(n => [1, 2, 3, 4, 5].map(i => (i < n ? 'done' : i === n ? 'reading' : 'queued'))),
        )
        expect(s.etaMs).toBeUndefined()
        expect((await stored(root, 'a.pdf')).map(p => p.text)).toEqual([1, 2, 3, 4, 5].map(n => `${PROSE} ${n}`))
    })

    test('a low-confidence page read by ai shows reading, then done by ai, before the next page starts', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        const during: { engine?: string; status: string[] }[] = []
        const after: string[] = []
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                const n = p![0]
                if (n === 3) after.push(JSON.stringify(transcribeJobState('a.pdf')!.pages.map(x => [x.status, x.engine])))
                return [{ page: n, text: PROSE, confidence: n === 2 ? 0.1 : 0.9 }]
            },
            ai: async (_a, _k, p) => {
                const pages = transcribeJobState('a.pdf')!.pages
                during.push({ status: pages.map(x => x.status) })
                return p!.map(page => ({ page, text: `ai ${page}` }))
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(during).toEqual([{ status: ['done', 'reading', 'queued'] }])
        // page 2 was already done by ai when page 3 started
        expect(JSON.parse(after[0])).toEqual([['done', 'on-device'], ['done', 'ai'], ['reading', 'on-device']])
        const s = transcribeJobState('a.pdf')!
        expect(s.pages.map(p => [p.status, p.engine])).toEqual([['done', 'on-device'], ['done', 'ai'], ['done', 'on-device']])
        expect((await stored(root, 'a.pdf')).map(p => p.text)).toEqual([PROSE, 'ai 2', PROSE])
    })

    test('etaMs is absent until a page is done, then the mean page time times the pages left', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        const g = gate()
        setTranscribeEngines({
            onDevice: async (_a, _k, pages) => {
                if (pages![0] === 2) await g.wait
                return [{ page: pages![0], text: PROSE, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        await until(() => transcribeJobState('a.pdf')?.pages.some(p => p.status === 'reading' && p.page === 2) ?? false)
        const s = transcribeJobState('a.pdf')!
        const p1 = s.pages[0]
        expect(p1.status).toBe('done')
        expect(s.etaMs).toBe(Math.round(p1.ms! * 2))
        g.open()
        await transcribeJobSettled('a.pdf')
        expect(transcribeJobState('a.pdf')!.etaMs).toBeUndefined()
    })

    test('a marker run moves its pages together', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        const g = gate()
        setTranscribeEngines({
            marker: async () => {
                await g.wait
                return [1, 2, 3].map(page => ({ page, text: `m${page}` }))
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'marker' }, { settings })
        await until(() => transcribeJobState('a.pdf')?.pages.every(p => p.status === 'reading') ?? false)
        g.open()
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.pages.map(p => [p.status, p.engine])).toEqual([1, 2, 3].map(() => ['done', 'marker']))
    })

    test('an ai page that fails is reported failed and the run goes on', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        setTranscribeEngines({
            ai: async (_a, _k, pages) => {
                if (pages![0] === 2) throw new Error('bad turn')
                return [{ page: pages![0], text: `ai${pages![0]}` }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'ai' }, { settings })
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
        expect(s.pages.map(p => p.status)).toEqual(['done', 'failed', 'done'])
        expect(s.pages[1].error).toBe('bad turn')
    })

    test('a run with every page failing ends failed with the reason', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        setTranscribeEngines({
            onDevice: async () => {
                throw new Error('boom')
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('failed')
        expect(s.error).toBe('boom')
    })
})

describe('cancel', () => {
    test('stops after the page in hand, keeps finished pages and writes nothing later', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 4)
        const g = gate()
        const reads: number[] = []
        setTranscribeEngines({
            onDevice: async (_a, _k, pages) => {
                reads.push(pages![0])
                if (pages![0] === 2) await g.wait
                return [{ page: pages![0], text: `t${pages![0]}`, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        await until(() => reads.includes(2))
        expect(cancelTranscribeJob('a.pdf')!.state).toBe('cancelled')
        g.open()
        await transcribeJobSettled('a.pdf')
        expect(transcribeJobState('a.pdf')!.state).toBe('cancelled')
        expect(reads).toEqual([1, 2])
        expect((await stored(root, 'a.pdf')).map(p => p.page)).toEqual([1])
    })

    test('a new start after a cancel waits for the stopped engine to settle', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        const g = gate()
        const log: string[] = []
        let first = true
        setTranscribeEngines({
            onDevice: async (_a, _k, pages) => {
                const mine = first
                first = false
                log.push(`start ${mine ? 'old' : 'new'}`)
                if (mine) await g.wait
                log.push(`end ${mine ? 'old' : 'new'}`)
                return [{ page: pages![0], text: PROSE, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        await until(() => log.length === 1)
        cancelTranscribeJob('a.pdf')
        startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        await new Promise(r => setTimeout(r, 30))
        expect(log).toEqual(['start old'])
        g.open()
        await transcribeJobSettled('a.pdf')
        expect(log.slice(0, 2)).toEqual(['start old', 'end old'])
        expect(log[2]).toBe('start new')
        expect(transcribeJobState('a.pdf')!.state).toBe('done')
    })

    test('cancelling marker kills the real child and its descendants', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        const pidFile = join(root, 'child.pid')
        setTranscribeEngines({
            marker: async (_a, _k, _p, signal) => {
                // a shell that starts a sleeping child and records its pid, run through runTool as marker is
                await runTool('sh', ['-c', `sleep 60 & echo $! > ${pidFile}; wait`], signal)
                if (signal?.aborted) throw new Error('cancelled')
                return []
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'marker' }, { settings })
        await until(() => {
            try {
                return Number(require('node:fs').readFileSync(pidFile, 'utf8')) > 0
            } catch {
                return false
            }
        })
        const child = Number(require('node:fs').readFileSync(pidFile, 'utf8'))
        const alive = () => {
            try {
                process.kill(child, 0)
                return true
            } catch {
                return false
            }
        }
        expect(alive()).toBe(true)
        expect(cancelTranscribeJob('a.pdf')!.state).toBe('cancelled')
        await transcribeJobSettled('a.pdf')
        expect(alive()).toBe(false)
        expect(transcribeJobState('a.pdf')!.state).toBe('cancelled')
    }, 20_000)
})

describe('math choice', () => {
    function mathEngines(pages: number, onMarker?: (p: number[]) => void) {
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                const n = p![0]
                return [{ page: n, text: n === 1 || n === 3 ? MATH : PROSE, confidence: 0.9 }]
            },
            marker: async (_a, _k, p) => {
                onMarker?.(p!)
                return p!.map(page => ({ page, text: `marker ${page}` }))
            },
        })
        return pages
    }

    test('ask lists math pages while the run goes on, careful re-reads them with marker', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 4)
        const g = gate()
        const markerCalls: number[][] = []
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                const n = p![0]
                if (n === 2) await g.wait
                return [{ page: n, text: n === 1 || n === 3 ? MATH : PROSE, confidence: 0.9 }]
            },
            marker: async (_a, _k, p) => {
                markerCalls.push(p!)
                return p!.map(page => ({ page, text: `marker ${page}` }))
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto' }, { settings })
        await until(() => transcribeJobState('a.pdf')?.mathPending.length === 1)
        expect(transcribeJobState('a.pdf')!.mathPending).toEqual([1])
        expect(decideTranscribeMath('a.pdf', 'careful')!.state).toBe('running')
        g.open()
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
        expect(s.mathPending).toEqual([])
        expect(markerCalls).toEqual([[1, 3]])
        expect((await stored(root, 'a.pdf')).map(p => p.text)).toEqual(['marker 1', PROSE, 'marker 3', PROSE])
        expect(s.pages.map(p => p.engine)).toEqual(['marker', 'on-device', 'marker', 'on-device'])
    })

    test('careful with no marker re-reads with ai and flags markerMissing', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => [{ page: p![0], text: p![0] === 1 ? MATH : PROSE, confidence: 0.9 }],
            marker: async () => {
                const { AppError } = await import('../src/error')
                throw new AppError('MARKER_UNAVAILABLE', 'not installed', 503)
            },
            ai: async (_a, _k, p) => p!.map(page => ({ page, text: `ai ${page}` })),
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'careful' }, { settings })
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.markerMissing).toBe(true)
        expect(s.pages[0]).toMatchObject({ status: 'done', engine: 'ai' })
        expect((await stored(root, 'a.pdf'))[0].text).toBe('ai 1')
    })

    test('fast clears the list; no choice leaves the job done with the list kept', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        mathEngines(3)
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto' }, { settings })
        await transcribeJobSettled('a.pdf')
        let s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
        expect(s.mathPending).toEqual([1, 3])
        expect(decideTranscribeMath('a.pdf', 'fast')!.mathPending).toEqual([])
        expect((await stored(root, 'a.pdf'))[0].text).toBe(MATH)
        s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
    })

    test('a careful choice after the run re-reads the pending pages', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        const calls: number[][] = []
        mathEngines(3, p => calls.push(p))
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto' }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(decideTranscribeMath('a.pdf', 'careful')!.state).toBe('running')
        await transcribeJobSettled('a.pdf')
        const s = transcribeJobState('a.pdf')!
        expect(s.state).toBe('done')
        expect(s.mathPending).toEqual([])
        expect(calls).toEqual([[1, 3]])
        expect((await stored(root, 'a.pdf'))[0].text).toBe('marker 1')
    })
})

describe('queue', () => {
    test('a start while the file runs joins it, and two files run one at a time in start order', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 1)
        await pdf(root, 'b.pdf', 1)
        const g = gate()
        const log: string[] = []
        setTranscribeEngines({
            onDevice: async (abs, _k, p) => {
                const name = abs.endsWith('a.pdf') ? 'a' : 'b'
                log.push(`start ${name}`)
                if (name === 'a') await g.wait
                log.push(`end ${name}`)
                return [{ page: p![0], text: PROSE, confidence: 0.9 }]
            },
        })
        const first = startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        const joined = startTranscribeJob(root, { file: 'a.pdf', engine: 'on-device' }, { settings })
        expect(joined.startedAt).toBe(first.startedAt)
        startTranscribeJob(root, { file: 'b.pdf', engine: 'on-device' }, { settings })
        await new Promise(r => setTimeout(r, 40))
        expect(log).toEqual(['start a'])
        g.open()
        await transcribeJobSettled('b.pdf')
        expect(log).toEqual(['start a', 'end a', 'start b', 'end b'])
    })

    test('an image is one page', async () => {
        const root = makeVault({})
        writeFileSync(join(root, 'i.png'), 'x')
        setTranscribeEngines({ onDevice: async () => [{ page: 1, text: PROSE, confidence: 0.9 }] })
        startTranscribeJob(root, { file: 'i.png', engine: 'on-device' }, { settings })
        await transcribeJobSettled('i.png')
        expect(transcribeJobState('i.png')!.pages).toHaveLength(1)
    })

    test('no job for a file answers null', () => {
        expect(transcribeJobState('nope.pdf')).toBeNull()
        expect(cancelTranscribeJob('nope.pdf')).toBeNull()
        expect(decideTranscribeMath('nope.pdf', 'fast')).toBeNull()
    })
})
