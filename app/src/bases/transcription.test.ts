import { expect, test } from 'bun:test'
import { createRoot } from 'solid-js'
import { createTranscription, progressReadout, replaceBody, replaceTitle, transcribeAllLabel, type TranscribeJobClient } from './transcription'
import type { TranscribeJobRequest, TranscribeJobState } from '../../../core/src/transcribeJobTypes'

/** A fake server: a job advances one page per `advance()`; math pages are announced when read. */
function fakeClient(opts: { mathPages?: Record<string, number[]>; markerInstalled?: boolean } = {}) {
    const state = new Map<string, TranscribeJobState>()
    const calls: string[] = []
    const requests: TranscribeJobRequest[] = []
    const reading = new Map<string, number>()
    const advance = () => {
        for (const [file, j] of state) {
            if (j.state !== 'running') continue
            const i = reading.get(file) ?? 0
            if (i < j.pages.length) {
                j.pages[i] = { ...j.pages[i], status: 'done', engine: 'on-device', ms: 1000 }
                reading.set(file, i + 1)
                if (opts.mathPages?.[file]?.includes(j.pages[i].page)) j.mathPending.push(j.pages[i].page)
                const left = j.pages.length - (i + 1)
                j.etaMs = left * 1000
            }
            if (i + 1 >= j.pages.length) j.state = 'done'
        }
    }
    const snap = (j: TranscribeJobState): TranscribeJobState => structuredClone(j)
    const client: TranscribeJobClient = {
        startTranscribeJob: async req => {
            requests.push(req)
            calls.push(`start ${req.file}`)
            const pages = (req.pages ?? [1, 2, 3]).map(page => ({ page, status: 'queued' as const }))
            const j: TranscribeJobState = { file: req.file, state: 'running', pages, startedAt: 0, mathPending: [] }
            state.set(req.file, j)
            reading.set(req.file, 0)
            return snap(j)
        },
        transcribeJob: async file => (state.has(file) ? snap(state.get(file)!) : null),
        cancelTranscribeJob: async file => {
            calls.push(`cancel ${file}`)
            const j = state.get(file)!
            j.state = 'cancelled'
            return snap(j)
        },
        decideTranscribeMath: async (file, choice) => {
            calls.push(`decide ${file} ${choice}`)
            state.get(file)!.mathPending = []
            return snap(state.get(file)!)
        },
        markerSetup: async () => ({ installed: opts.markerInstalled ?? true, missing: [], job: { state: 'idle' } }),
        startMarkerSetup: async () => {
            calls.push('install')
            return { state: 'done', startedAt: 0, endedAt: 1 }
        },
    }
    return { client, advance, calls, requests, state }
}
const flush = () => new Promise(r => setTimeout(r, 0))

function make(f: ReturnType<typeof fakeClient>, math: 'ask' | 'careful' | 'fast' = 'ask') {
    const toasts: string[] = []
    const set: string[] = []
    const t = createRoot(() =>
        createTranscription({ client: f.client, math: () => math, setMath: m => set.push(m), toast: m => toasts.push(m), pollMs: 1e9 }),
    )
    return { t, toasts, set }
}

test('progress counts agree across two files and the eta passes through', async () => {
    const f = fakeClient()
    const { t } = make(f)
    t.start('a.pdf')
    t.start('b.pdf', { pages: [4, 5] })
    await flush()
    expect(t.progress()).toEqual({ done: 0, total: 5 })
    f.advance()
    await t.tick()
    expect(t.progress()).toEqual({ done: 2, total: 5, etaMs: 2000 + 1000 })
    expect(t.pageState('a.pdf', 1)?.status).toBe('done')
    expect(t.pageState('a.pdf', 3)?.status).toBe('queued')
    t.dispose()
})

test('cancel cancels every running job and toasts each', async () => {
    const f = fakeClient()
    const { t, toasts } = make(f)
    t.start('x/a.pdf')
    t.start('b.pdf')
    await flush()
    f.advance()
    await t.tick()
    t.cancel()
    await flush()
    expect(f.calls.filter(c => c.startsWith('cancel')).sort()).toEqual(['cancel b.pdf', 'cancel x/a.pdf'])
    expect(toasts.sort()).toEqual(['stopped transcribing a.pdf', 'stopped transcribing b.pdf'])
    expect(t.progress()).toBeUndefined()
    expect(t.pageState('b.pdf', 1)?.status).toBe('done')
    expect(t.pageState('b.pdf', 2)).toBeUndefined()
    t.dispose()
})

test('chooseMath mid-run decides each running file and remembers', async () => {
    const f = fakeClient({ mathPages: { 'a.pdf': [1], 'b.pdf': [1], 'c.pdf': [] } })
    const { t, set } = make(f)
    for (const file of ['a.pdf', 'b.pdf', 'c.pdf']) t.start(file)
    await flush()
    f.advance()
    await t.tick()
    expect(t.mathPending()).toBe(2)
    t.chooseMath('fast', true)
    expect(t.mathPending()).toBe(0)
    await flush()
    expect(f.calls.filter(c => c.startsWith('decide'))).toEqual(['decide a.pdf fast', 'decide b.pdf fast', 'decide c.pdf fast'])
    expect(set).toEqual(['fast'])
    expect(t.mathPending()).toBe(0)
    t.dispose()
})

test('chooseMath decides every running file and files started later in the batch inherit it', async () => {
    const f = fakeClient({ mathPages: { 'a.pdf': [1], 'c.pdf': [1] } })
    const { t } = make(f)
    for (const file of ['a.pdf', 'b.pdf', 'c.pdf']) t.start(file, { pages: [1, 2] })
    await flush()
    f.advance()
    await t.tick()
    expect(t.mathPending()).toBe(2)
    t.chooseMath('fast', false)
    expect(t.mathPending()).toBe(0)
    await flush()
    expect(f.calls.filter(c => c.startsWith('decide'))).toEqual(['decide a.pdf fast', 'decide b.pdf fast', 'decide c.pdf fast'])
    t.start('d.pdf', { pages: [1, 2] })
    await flush()
    expect(f.requests.at(-1)).toMatchObject({ file: 'd.pdf', math: 'fast' })
    expect(t.mathPending()).toBe(0)
    t.dispose()
})

test('adopt records a finished job and keeps it in the batch beside running ones', async () => {
    const f = fakeClient()
    const first = make(f)
    first.t.start('a.png', { pages: [1] })
    first.t.start('b.png', { pages: [1, 2] })
    await flush()
    f.advance()
    first.t.dispose()
    const { t } = make(f)
    t.adopt('a.png')
    t.adopt('b.png')
    await flush()
    expect(t.pageState('a.png', 1)?.status).toBe('done')
    expect(t.progress()).toMatchObject({ done: 2, total: 3 })
    t.dispose()
})

test('a careful choice with the math reader missing installs first', async () => {
    const f = fakeClient({ mathPages: { 'a.pdf': [1] }, markerInstalled: false })
    const { t, set } = make(f)
    t.start('a.pdf')
    await flush()
    f.state.get('a.pdf')!.markerMissing = true
    f.advance()
    await t.tick()
    expect(t.markerMissing()).toBe(true)
    t.chooseMath('careful', false)
    expect(t.installing()).toBe(true)
    await flush()
    expect(f.calls.slice(-2)).toEqual(['install', 'decide a.pdf careful'])
    expect(t.installing()).toBe(false)
    expect(set).toEqual([])
    t.dispose()
})

test('redo with an engine starts a replacing job for that page', async () => {
    const f = fakeClient()
    const { t } = make(f)
    t.start('a.pdf', { pages: [7], engine: 'ai' })
    await flush()
    expect(f.requests[0]).toEqual({ file: 'a.pdf', engine: 'ai', pages: [7] })
    t.dispose()
})

test('a redo asked while the file runs waits for the job to end, then runs', async () => {
    const f = fakeClient()
    const { t } = make(f)
    t.start('a.pdf')
    await flush()
    t.start('a.pdf', { pages: [2], engine: 'ai' })
    await flush()
    expect(f.requests.length).toBe(1)
    for (let i = 0; i < 3; i++) f.advance()
    await t.tick()
    await flush()
    expect(f.requests.length).toBe(2)
    expect(f.requests[1]).toEqual({ file: 'a.pdf', engine: 'ai', pages: [2] })
    t.dispose()
})

test('a button run fills gaps with the vault math setting, and auto runs once per file', async () => {
    const f = fakeClient()
    const { t } = make(f, 'careful')
    t.auto('a.pdf')
    t.auto('a.pdf')
    await flush()
    expect(f.requests).toEqual([{ file: 'a.pdf', onlyMissing: true, math: 'careful' }])
    t.dispose()
})

test('onWrote fires per page done', async () => {
    const f = fakeClient()
    const { t } = make(f)
    const got: string[] = []
    t.onWrote(file => got.push(file))
    t.start('a.pdf')
    await flush()
    f.advance()
    await t.tick()
    f.advance()
    await t.tick()
    await t.tick()
    expect(got).toEqual(['a.pdf', 'a.pdf'])
    t.dispose()
})

test('storedMath asks once per file, then a careful choice re-reads those pages', async () => {
    const f = fakeClient()
    const { t } = make(f)
    t.storedMath('a.pdf', [2, 3])
    t.storedMath('a.pdf', [2, 3])
    expect(t.mathPending()).toBe(2)
    t.chooseMath('careful', false)
    await flush()
    expect(f.requests).toEqual([{ file: 'a.pdf', pages: [2, 3], math: 'careful' }])
    t.dispose()
})

test('progressReadout', () => {
    expect(progressReadout({ done: 0, total: 0 })).toBe('transcribing')
    expect(progressReadout({ done: 0, total: 12 })).toBe('transcribing 1 of 12')
    expect(progressReadout({ done: 3, total: 12, etaMs: 110_000 })).toBe('transcribing 4 of 12 // about 2 min left')
    expect(progressReadout({ done: 10, total: 12, etaMs: 40_000 })).toBe('transcribing 11 of 12 // under a minute left')
    // a one-page re-read names its page, never "1 of 1"
    expect(progressReadout({ done: 0, total: 1, page: 4 })).toBe('transcribing page 4')
    expect(progressReadout({ done: 0, total: 1, page: 4, etaMs: 20_000 })).toBe('transcribing page 4 // under a minute left')
    expect(progressReadout({ done: 0, total: 6, page: 4 })).toBe('transcribing 1 of 6')
})

test('after a careful choice the prompt stays closed once the server answers an empty list', async () => {
    const f = fakeClient({ mathPages: { 'a.pdf': [1] } })
    const { t } = make(f)
    t.start('a.pdf')
    await flush()
    f.advance()
    await t.tick()
    expect(t.mathPending()).toBe(1)
    t.chooseMath('careful', false)
    await flush()
    expect(t.mathPending()).toBe(0)
    f.advance()
    await t.tick()
    expect(t.mathPending()).toBe(0)
    t.dispose()
})

test('progress is scoped to the batch: finished files stay in both counts', async () => {
    const f = fakeClient()
    const { t } = make(f)
    for (const file of ['a.png', 'b.png', 'c.png']) t.start(file, { pages: [1] })
    await flush()
    const finish = (file: string) => {
        const j = f.state.get(file)!
        j.pages[0] = { ...j.pages[0], status: 'done', engine: 'on-device', ms: 1 }
        j.state = 'done'
    }
    const readout = () => {
        const p = t.progress()
        return p && `${Math.min(p.total, p.done + 1)} of ${p.total}`
    }
    expect(readout()).toBe('1 of 3')
    finish('a.png')
    await t.tick()
    expect(t.progress()).toMatchObject({ done: 1, total: 3 })
    finish('b.png')
    await t.tick()
    expect(t.progress()).toMatchObject({ done: 2, total: 3 })
    finish('c.png')
    await t.tick()
    expect(t.progress()).toBeUndefined()
    t.dispose()
})

test('storedMath leaves a file whose job runs to the job: one page is one pending page', async () => {
    const f = fakeClient({ mathPages: { 'a.pdf': [2] } })
    const { t } = make(f)
    t.start('a.pdf')
    await flush()
    f.advance()
    f.advance()
    await t.tick()
    expect(t.mathPending()).toBe(1)
    t.storedMath('a.pdf', [2])
    await flush()
    expect(t.mathPending()).toBe(1)
    t.dispose()
})

test('a fresh controller adopts a job already running: progress and cancel work', async () => {
    const f = fakeClient()
    const a = make(f)
    a.t.start('a.pdf')
    await flush()
    f.advance()
    f.advance()
    a.t.dispose()
    const { t, toasts } = make(f)
    expect(t.progress()).toBeUndefined()
    t.adopt('a.pdf')
    await flush()
    expect(t.progress()).toMatchObject({ done: 2, total: 3 })
    t.cancel()
    await flush()
    expect(f.calls).toContain('cancel a.pdf')
    expect(toasts).toEqual(['stopped transcribing a.pdf'])
    expect(t.progress()).toBeUndefined()
    t.dispose()
})

test('the whole-document menu and its question name the pages', () => {
    expect(transcribeAllLabel(59, 'with ai')).toBe('transcribe all 59 pages with ai')
    expect(transcribeAllLabel(1, 'on-device')).toBe('transcribe on-device')
    expect(replaceTitle(1)).toBe('replace the text of 1 page?')
    expect(replaceTitle(59)).toBe('replace the text of 59 pages?')
    expect(replaceBody(59, 'with ai', true)).toBe('all 59 pages are read again with ai, one turn a page. what they hold now goes, including anything you typed.')
    expect(replaceBody(1, 'on-device', false)).toBe('the page is read again on-device. what it holds now goes, including anything you typed.')
})
