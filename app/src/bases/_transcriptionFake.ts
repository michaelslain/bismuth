// app/src/bases/_transcriptionFake.ts
// Story seam for the reader's transcription: a fake job client whose jobs advance one page per
// `controller.tick()`, never a timer, plus the `api` reads and writes a transcript needs. Shared by the
// BookView and PreviewView stories.
import { api } from '../api'
import { settings, setSettings } from '../settings'
import { pushToast } from '../ui/toastStore'
import { createTranscription, type TranscribeJobClient, type TranscriptionController } from './transcription'
import type { TranscribeJobState, TranscribePageState } from '../../../core/src/transcribeJobTypes'
import type { TranscriptCheck, TranscriptEngine } from '../../../core/src/transcript'
import { liveChecks } from '../../../core/src/transcriptChecks'

export type FakeOptions = {
    /** pages a file has (default 1) */
    pageCount?: (file: string) => number
    /** the text a page gets when its read finishes */
    text?: (file: string, page: number) => string
    /** `file#page` keys that look like math: a read of one with `math: 'ask'` lists it as pending */
    mathKeys?: string[]
    /** `file#page` keys whose read fails */
    failKeys?: string[]
    /** ms left once a page has finished, from the pages still to read (default 60 s a page) */
    etaMs?: (left: number) => number
    /** the math reader is installed (default true) */
    markerInstalled?: boolean
    /** line boxes `api.transcriptLines` answers with */
    lines?: (file: string, page: number) => { text: string; x: number; y: number; w: number; h: number }[]
}

type Job = TranscribeJobState & { engine?: TranscriptEngine; math?: 'ask' | 'careful' | 'fast' }

export type FakeTranscription = {
    client: TranscribeJobClient
    /** every `startTranscribeJob` request */
    calls: { file: string; pages?: number[]; engine?: string; math?: string }[]
    decisions: string[]
    /** `install` and `decide:<choice>` in the order the client saw them */
    events: string[]
    /** `file#page` -> text: what `api.storedTranscript` serves */
    texts: Map<string, string>
    /** `file#page` -> review checks: served with the page's text while they still apply */
    checks: Map<string, TranscriptCheck[]>
    /** every `api.approveTranscriptCheck` call, as `file#page:line` */
    approvals: string[]
    /** every `api.setTranscriptPage` write */
    saves: { file: string; page: number; text: string }[]
    ctl?: TranscriptionController & { tick(): Promise<void> }
    /** a controller over this client; the last one made is `ctl` */
    controller: () => TranscriptionController & { tick(): Promise<void> }
    tick: (n?: number) => Promise<void>
    /** patch `api` to serve and record transcripts; the returned function puts it back */
    install: () => () => void
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

export function fakeTranscribe(opts: FakeOptions = {}): FakeTranscription {
    const jobs = new Map<string, Job>()
    const texts = new Map<string, string>()
    const calls: FakeTranscription['calls'] = []
    const decisions: string[] = []
    const events: string[] = []
    let setupDone = false
    const saves: FakeTranscription['saves'] = []
    const checks = new Map<string, TranscriptCheck[]>()
    const approvals: string[] = []
    const count = (file: string) => opts.pageCount?.(file) ?? 1
    const textOf = (file: string, page: number) => opts.text?.(file, page) ?? `Page ${page}`
    const snapshot = (j: Job): TranscribeJobState => ({
        file: j.file,
        state: j.state,
        pages: j.pages.map(p => ({ ...p })),
        startedAt: j.startedAt,
        mathPending: [...j.mathPending],
        ...(j.etaMs !== undefined ? { etaMs: j.etaMs } : {}),
        ...(opts.markerInstalled === false && !setupDone ? { markerMissing: true } : {}),
    })
    const finish = (j: Job, p: TranscribePageState) => {
        const key = `${j.file}#${p.page}`
        if (opts.failKeys?.includes(key)) {
            p.status = 'failed'
            p.error = 'the reader returned nothing for this page'
            return
        }
        texts.set(key, textOf(j.file, p.page))
        p.status = 'done'
        p.engine = j.engine ?? 'on-device'
        p.ms = 1000
    }
    const advance = (j: Job) => {
        const reading = j.pages.find(p => p.status === 'reading')
        if (reading) finish(j, reading)
        const next = j.pages.find(p => p.status === 'queued')
        if (next) {
            next.status = 'reading'
            next.engine = j.engine ?? 'on-device'
            if (j.math === 'ask' && !j.engine && opts.mathKeys?.includes(`${j.file}#${next.page}`)) j.mathPending.push(next.page)
        }
        const left = j.pages.filter(p => p.status !== 'done' && p.status !== 'failed').length
        if (j.pages.some(p => p.status === 'done')) j.etaMs = opts.etaMs ? opts.etaMs(left) : left * 60_000
        if (left === 0) j.state = 'done'
    }
    const firstRunning = () => [...jobs.values()].find(j => j.state === 'running')
    const client: TranscribeJobClient = {
        startTranscribeJob: async req => {
            calls.push({ file: req.file, pages: req.pages, engine: req.engine, math: req.math })
            const live = jobs.get(req.file)
            if (live?.state === 'running') return snapshot(live)
            let pages = req.pages ?? range(count(req.file))
            if (req.onlyMissing) pages = pages.filter(p => !texts.has(`${req.file}#${p}`))
            const j: Job = {
                file: req.file,
                state: pages.length ? 'running' : 'done',
                pages: pages.map(page => ({ page, status: 'queued' as const })),
                startedAt: 0,
                mathPending: [],
                engine: req.engine && req.engine !== 'auto' ? req.engine : undefined,
                math: req.math,
            }
            jobs.set(req.file, j)
            return snapshot(j)
        },
        transcribeJob: async file => {
            const j = jobs.get(file)
            if (!j) return null
            if (j.state === 'running' && firstRunning() === j) advance(j)
            return snapshot(j)
        },
        cancelTranscribeJob: async file => {
            const j = jobs.get(file)!
            j.state = 'cancelled'
            return snapshot(j)
        },
        decideTranscribeMath: async (file, choice) => {
            decisions.push(choice)
            events.push(`decide:${choice}`)
            const j = jobs.get(file)!
            j.mathPending = []
            j.math = choice
            return snapshot(j)
        },
        markerSetup: async () => ({ installed: opts.markerInstalled !== false || setupDone, job: { state: 'idle' } }) as never,
        startMarkerSetup: async () => {
            events.push('install')
            setupDone = true
            return { state: 'done' } as never
        },
    }
    const fake: FakeTranscription = {
        client,
        calls,
        decisions,
        events,
        texts,
        checks,
        approvals,
        saves,
        controller: () => {
            const ctl = createTranscription({
                client,
                math: () => settings.transcription.math as 'ask' | 'careful' | 'fast',
                setMath: m => setSettings('transcription', 'math', m),
                toast: pushToast,
                pollMs: 1_000_000_000,
            })
            fake.ctl = ctl
            return ctl
        },
        tick: async (n = 1) => {
            for (let i = 0; i < n; i++) await fake.ctl!.tick()
        },
        install: () => {
            const original = {
                stored: api.storedTranscript,
                set: api.setTranscriptPage,
                lines: api.transcriptLines,
                mark: api.markTranscript,
                approve: api.approveTranscriptCheck,
            }
            api.storedTranscript = async (file: string) => ({
                engine: 'on-device' as const,
                at: '2026-10-31T00:00:00.000Z',
                pages: [...texts].flatMap(([key, text]) => {
                    const [f, page] = key.split('#')
                    if (f !== file) return []
                    const live = liveChecks(text, checks.get(key))
                    return [live.length ? { page: Number(page), text, checks: live } : { page: Number(page), text }]
                }),
            })
            api.setTranscriptPage = (async (file: string, page: number, text: string) => {
                saves.push({ file, page, text })
                texts.set(`${file}#${page}`, text)
                return { ok: true }
            }) as typeof api.setTranscriptPage
            api.approveTranscriptCheck = (async (file: string, page: number, line: string) => {
                const key = `${file}#${page}`
                approvals.push(`${key}:${line}`)
                const left = (checks.get(key) ?? []).filter(c => c.line !== line)
                checks.set(key, left)
                return { ok: true, companion: `${file}.md`, checks: left }
            }) as typeof api.approveTranscriptCheck
            api.transcriptLines = (async (file: string, pages?: number[]) => ({
                pages: (pages ?? [1]).map(page => ({ page, lines: opts.lines?.(file, page) ?? [] })),
            })) as typeof api.transcriptLines
            return () => {
                api.storedTranscript = original.stored
                api.setTranscriptPage = original.set
                api.transcriptLines = original.lines
                api.markTranscript = original.mark
                api.approveTranscriptCheck = original.approve
            }
        },
    }
    return fake
}
