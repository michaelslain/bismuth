// core/test/transcribeJobFixes.test.ts — the per-companion write lock, the paged onlyMissing and the
// job route's plain handler. Engines are faked.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { PDFDocument } from 'pdf-lib'
import { setTranscribeEngines, withCompanion, type TranscriptionSettings } from '../src/transcribe'
import {
    cancelTranscribeJob,
    decideTranscribeMath,
    resetTranscribeJobs,
    startTranscribeJob,
    transcribeJobSettled,
    transcribeJobState,
} from '../src/transcribeJob'
import { readTranscript, writeTranscriptPage } from '../src/transcript'
import { makeVault } from './helpers'

const settings: TranscriptionSettings = { auto: true, engine: 'auto', math: 'fast', provider: 'auto', model: '' }

async function pdf(root: string, name: string, n: number) {
    const doc = await PDFDocument.create()
    for (let i = 0; i < n; i++) doc.addPage([100, 100])
    writeFileSync(join(root, name), await doc.save())
}

const stored = async (root: string, file: string) =>
    readTranscript(await readFile(join(root, `${file}.md`), 'utf8').catch(() => ''))

beforeEach(() => resetTranscribeJobs())
afterEach(() => {
    resetTranscribeJobs()
    setTranscribeEngines(null)
})

describe('withCompanion', () => {
    test('runs writes to one companion one after another, even after a failure', async () => {
        const order: string[] = []
        const slow = withCompanion('a.pdf.md', async () => {
            order.push('a start')
            await new Promise(r => setTimeout(r, 30))
            order.push('a end')
            throw new Error('boom')
        })
        const next = withCompanion('a.pdf.md', async () => {
            order.push('b')
            return 2
        })
        const other = withCompanion('z.pdf.md', async () => order.push('z'))
        await slow.catch(() => {})
        expect(await next).toBe(2)
        await other
        expect(order.indexOf('z')).toBeLessThan(order.indexOf('a end'))
        expect(order.filter(o => o !== 'z')).toEqual(['a start', 'a end', 'b'])
    })

    test('a hand edit during a job keeps both the edit and the pages the job wrote', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 4)
        let edited: Promise<unknown> | undefined
        setTranscribeEngines({
            onDevice: async (_abs, _kind, pages) => {
                const n = pages![0]
                if (n === 2)
                    edited = withCompanion('a.pdf.md', () => writeTranscriptPage(root, 'a.pdf.md', 1, 'by hand', 'pdf'))
                return [{ page: n, text: `page ${n}`, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        await transcribeJobSettled('a.pdf')
        await edited
        const got = await stored(root, 'a.pdf')
        expect(got.map(p => p.text)).toEqual(['by hand', 'page 2', 'page 3', 'page 4'])
    })
})

describe('onlyMissing on a job', () => {
    test('after a cancel it reads only the pages without text', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 4)
        const reads: number[] = []
        let cancelAt = 2
        setTranscribeEngines({
            onDevice: async (_abs, _kind, pages) => {
                const n = pages![0]
                reads.push(n)
                if (n === cancelAt) cancelTranscribeJob('a.pdf')
                return [{ page: n, text: `page ${n}`, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(transcribeJobState('a.pdf')!.state).toBe('cancelled')
        const have = (await stored(root, 'a.pdf')).map(p => p.page)
        expect(have.length).toBeGreaterThan(0)
        expect(have.length).toBeLessThan(4)

        cancelAt = 0
        reads.length = 0
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast', onlyMissing: true }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(transcribeJobState('a.pdf')!.state).toBe('done')
        expect(reads).toEqual([1, 2, 3, 4].filter(n => !have.includes(n)))
        expect((await stored(root, 'a.pdf')).map(p => p.page)).toEqual([1, 2, 3, 4])
    })

    test('with every page stored it reads nothing', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        let calls = 0
        setTranscribeEngines({
            onDevice: async (_abs, _kind, pages) => {
                calls++
                return [{ page: pages![0], text: `page ${pages![0]}`, confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        await transcribeJobSettled('a.pdf')
        calls = 0
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast', onlyMissing: true }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(calls).toBe(0)
        expect(transcribeJobState('a.pdf')!.state).toBe('done')
    })
})

describe('seam with the reader', () => {
    const MATH = 'x = 1\ny = 2\nz > 3'
    const ask: TranscriptionSettings = { ...settings, math: 'ask' }
    const until = async (cond: () => boolean) => {
        for (let i = 0; i < 200 && !cond(); i++) await new Promise(r => setTimeout(r, 10))
    }

    test('an image job and a PDF job list their pages the moment they start', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 3)
        await pdf(root, 'b.pdf', 5)
        writeFileSync(join(root, 'p.png'), 'x')
        let release!: () => void
        const hold = new Promise<void>(r => (release = r))
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                await hold
                return [{ page: p?.[0] ?? 1, text: 'words', confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast' }, { settings })
        startTranscribeJob(root, { file: 'b.pdf', engine: 'auto', math: 'fast' }, { settings })
        startTranscribeJob(root, { file: 'p.png', engine: 'auto', math: 'fast' }, { settings })
        expect(transcribeJobState('p.png')!.pages.map(p => p.page)).toEqual([1])
        await until(() => transcribeJobState('b.pdf')!.pages.length === 5)
        expect(transcribeJobState('b.pdf')!.pages.map(p => [p.page, p.status])).toEqual(
            [1, 2, 3, 4, 5].map(n => [n, 'queued']),
        )
        release()
        await transcribeJobSettled('p.png')
    })

    test('a seeded onlyMissing job lists only the pages without text', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 4)
        await writeTranscriptPage(root, 'a.pdf.md', 2, 'have', 'pdf')
        let release!: () => void
        const hold = new Promise<void>(r => (release = r))
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                await hold
                return [{ page: p![0], text: 'words', confidence: 0.9 }]
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'fast', onlyMissing: true }, { settings })
        await until(() => transcribeJobState('a.pdf')!.pages.length > 0)
        expect(transcribeJobState('a.pdf')!.pages.map(p => p.page)).toEqual([1, 3, 4])
        release()
        await transcribeJobSettled('a.pdf')
    })

    test('math pages set markerMissing; a careful choice clears the list at once and re-reads once', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        const marker: number[][] = []
        const reading: (string | undefined)[] = []
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => [{ page: p![0], text: p![0] === 1 ? MATH : 'words', confidence: 0.9 }],
            marker: async (_a, _k, p) => {
                reading.push(transcribeJobState('a.pdf')!.pages[0].engine)
                marker.push(p!)
                return p!.map(page => ({ page, text: `marker ${page}` }))
            },
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto' }, { settings: ask })
        await transcribeJobSettled('a.pdf')
        let s = transcribeJobState('a.pdf')!
        expect(s.mathPending).toEqual([1])
        expect(typeof s.markerMissing).toBe('boolean')
        expect(decideTranscribeMath('a.pdf', 'careful')!.mathPending).toEqual([])
        expect(transcribeJobState('a.pdf')!.mathPending).toEqual([])
        await transcribeJobSettled('a.pdf')
        s = transcribeJobState('a.pdf')!
        expect(s.mathPending).toEqual([])
        expect(marker).toEqual([[1]])
        expect(reading).toEqual(['marker'])
        expect(s.pages[0]).toMatchObject({ status: 'done', engine: 'marker' })
    })

    test('a math page bound for the careful batch goes back to queued, not reading', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        const seen: string[] = []
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                if (p![0] === 2) seen.push(transcribeJobState('a.pdf')!.pages[0].status)
                return [{ page: p![0], text: p![0] === 1 ? MATH : 'words', confidence: 0.9 }]
            },
            marker: async (_a, _k, p) => p!.map(page => ({ page, text: `marker ${page}` })),
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto', math: 'careful' }, { settings })
        await transcribeJobSettled('a.pdf')
        expect(seen).toEqual(['queued'])
    })

    test('cancelling a running job drops its pending math pages', async () => {
        const root = makeVault({})
        await pdf(root, 'a.pdf', 2)
        let release!: () => void
        const hold = new Promise<void>(r => (release = r))
        setTranscribeEngines({
            onDevice: async (_a, _k, p) => {
                if (p![0] === 2) await hold
                return [{ page: p![0], text: p![0] === 1 ? MATH : 'words', confidence: 0.9 }]
            },
            marker: async (_a, _k, p) => p!.map(page => ({ page, text: `marker ${page}` })),
        })
        startTranscribeJob(root, { file: 'a.pdf', engine: 'auto' }, { settings: ask })
        await until(() => transcribeJobState('a.pdf')!.mathPending.length > 0)
        expect(transcribeJobState('a.pdf')!.mathPending).toEqual([1])
        expect(cancelTranscribeJob('a.pdf')).toMatchObject({ state: 'cancelled', mathPending: [] })
        release()
        await transcribeJobSettled('a.pdf')
        expect(transcribeJobState('a.pdf')!.mathPending).toEqual([])
    })
})
