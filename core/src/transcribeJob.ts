// core/src/transcribeJob.ts
// Transcription as a background job per file: the same runner as POST /transcribe and the CLI
// (transcribe.ts), run page by page so the app can show progress, cancel, and ask about math
// while the run goes on. One server process holds the jobs; a restart forgets them (the finished
// pages are already in the companion). Jobs run one at a time in start order, because the engines
// are machine-heavy, and a start after a cancel waits for the stopped engine to settle.
import { AppError } from './error'
import { companionPathFor } from './fileKinds'
import {
    checkPageFile,
    pagesWithoutText,
    readTranscriptionSettings,
    transcribe,
    transcribeMathPages,
    type MathChoice,
    type TranscribeOpts,
    type TranscriptionSettings,
} from './transcribe'
import type { TranscribeJobRequest, TranscribeJobState, TranscribePageState } from './transcribeJobTypes'

type Job = {
    root: string
    req: TranscribeJobRequest
    opts: { mark?: (paths: string[]) => void; settings?: TranscriptionSettings }
    state: TranscribeJobState
    ctrl: AbortController
    choice?: MathChoice
    /** pages a careful choice moved out of `mathPending`: the follow-up re-reads them */
    reread: number[]
    /** the reading pass is in progress: it consumes a careful choice itself, page by page */
    reading?: boolean
    /** the math reader's install check, loaded lazily so mobile core never imports it statically */
    markerInstalled?: () => boolean
    /** settles when the job's run, including a stopped engine's teardown, is over */
    settled: Promise<void>
}

const jobs = new Map<string, Job>()
let queue: Promise<void> = Promise.resolve()

/** The job as the routes answer it: a copy, with the estimate worked out. */
function snapshot(job: Job): TranscribeJobState {
    const s = job.state
    const done = s.pages.filter(p => p.status === 'done' && p.ms !== undefined)
    const left = s.pages.filter(p => p.status === 'queued' || p.status === 'reading').length
    const { etaMs: _drop, ...rest } = s
    return {
        ...rest,
        pages: s.pages.map(p => ({ ...p })),
        mathPending: [...s.mathPending],
        ...(done.length && s.state === 'running'
            ? { etaMs: Math.round((done.reduce((a, p) => a + p.ms!, 0) / done.length) * left) }
            : {}),
    }
}

function setPage(job: Job, p: TranscribePageState): void {
    const pages = job.state.pages.filter(x => x.page !== p.page)
    pages.push({ ...p })
    job.state.pages = pages.sort((a, b) => a.page - b.page)
}

const hooks = (job: Job): TranscribeOpts => ({
    mark: job.opts.mark,
    settings: job.opts.settings,
    signal: job.ctrl.signal,
    onPage: p => setPage(job, p),
    onMath: pages => {
        if (job.choice) return
        if (pages.length && job.state.markerMissing === undefined && job.markerInstalled)
            job.state.markerMissing = !job.markerInstalled()
        job.state.mathPending = pages
    },
    mathChoice: () => job.choice,
    onMarkerMissing: () => {
        job.state.markerMissing = true
    },
})

function fail(job: Job, e: unknown): void {
    if (job.ctrl.signal.aborted) return
    job.state.state = 'failed'
    job.state.mathPending = []
    job.reread = []
    job.state.error = e instanceof Error ? e.message : String(e)
    job.state.pages = job.state.pages.map(p =>
        p.status === 'queued' || p.status === 'reading' ? { ...p, status: 'failed', error: job.state.error } : p,
    )
}

/** Re-read the pages still waiting on a careful choice. */
async function followUp(job: Job, first: number[]): Promise<void> {
    let pages = first
    while (job.choice === 'careful' && pages.length && !job.ctrl.signal.aborted) {
        job.state.state = 'running'
        try {
            await transcribeMathPages(job.root, { file: job.req.file, book: job.req.book }, pages, hooks(job))
            if (!job.ctrl.signal.aborted) job.state.state = 'done'
        } catch (e) {
            fail(job, e)
        }
        pages = job.reread
        job.reread = []
    }
}

async function run(job: Job): Promise<void> {
    if (job.ctrl.signal.aborted) return
    try {
        // A request at `ask` is the setting at `ask`: the run asks through onMath instead of choosing.
        const { math, ...req } = job.req
        const settings = { ...(job.opts.settings ?? (await readTranscriptionSettings(job.root))) }
        if (math === 'ask') settings.math = 'ask'
        job.markerInstalled = (await import('./markerSetup')).markerStatus.bind(null) as never
        const mk = (await import('./markerSetup')).markerStatus
        job.markerInstalled = () => mk().installed
        job.reading = true
        let result: Awaited<ReturnType<typeof transcribe>>
        try {
            result = await transcribe(job.root, math && math !== 'ask' ? { ...req, math } : req, {
                ...hooks(job),
                settings,
            })
        } finally {
            job.reading = false
        }
        if (job.ctrl.signal.aborted) return
        const left = job.reread
        job.reread = []
        await followUp(job, [...new Set([...(result.math ?? []), ...left])])
        if (job.state.state === 'running') job.state.state = 'done'
    } catch (e) {
        fail(job, e)
    }
}

function enqueue(job: Job, work: () => Promise<void>): void {
    job.settled = queue.then(work)
    queue = job.settled.catch(() => {})
}

/** Seed a PDF job's pages at start (the page count, or the explicit pages), filtered to the pages
 *  with no stored text when `onlyMissing`, so the bar counts a file before its turn in the queue. */
async function seedPages(job: Job, explicit: number[]): Promise<void> {
    try {
        let all = explicit
        if (!all.length) {
            const { pdfPageCount } = await import('./pdfPages')
            const count = (await pdfPageCount(job.root, job.req.file)).pages
            all = Array.from({ length: count }, (_, i) => i + 1)
        }
        if (job.req.onlyMissing) all = await pagesWithoutText(job.root, companionPathFor(job.req.file), all)
        if (!job.state.pages.length && job.state.state === 'running')
            job.state.pages = all.map(page => ({ page, status: 'queued' as const }))
    } catch {
        // the run reports a file it cannot count
    }
}

/** Start the file's transcription in the background; answers the job at once. A start while a job for
 *  the file is running joins it. Throws EINVAL / UNSUPPORTED_FILE for a request that cannot run. */
export function startTranscribeJob(
    root: string,
    req: TranscribeJobRequest,
    opts: Job['opts'] = {},
): TranscribeJobState {
    const kind = checkPageFile(req.file)
    if (req.math !== undefined && !['ask', 'careful', 'fast'].includes(req.math))
        throw new AppError('EINVAL', 'math must be ask, careful or fast', 400)
    const live = jobs.get(req.file)
    if (live && live.state.state === 'running') return snapshot(live)
    const explicit = kind === 'pdf' && req.pages?.length ? [...new Set(req.pages)].sort((a, b) => a - b) : []
    const seeded = kind === 'image' ? [1] : req.onlyMissing ? [] : explicit
    const job: Job = {
        root,
        req,
        opts,
        state: {
            file: req.file,
            state: 'running',
            pages: seeded.map(page => ({ page, status: 'queued' })),
            startedAt: Date.now(),
            mathPending: [],
        },
        reread: [],
        ctrl: new AbortController(),
        settled: Promise.resolve(),
    }
    jobs.set(req.file, job)
    if (kind === 'pdf' && seeded.length === 0) void seedPages(job, explicit)
    enqueue(job, () => run(job))
    return snapshot(job)
}

/** The file's current or last job, null when this server run has none. */
export function transcribeJobState(file: string): TranscribeJobState | null {
    const job = jobs.get(file)
    return job ? snapshot(job) : null
}

/** Stop the file's job: state `cancelled` now, the engine stopped behind it. Finished pages keep their text. */
export function cancelTranscribeJob(file: string): TranscribeJobState | null {
    const job = jobs.get(file)
    if (!job) return null
    if (job.state.state === 'running') {
        job.state.state = 'cancelled'
        job.state.mathPending = []
        job.reread = []
        job.state.pages = job.state.pages.map(p => (p.status === 'reading' ? { ...p, status: 'queued' } : p))
        job.ctrl.abort()
    }
    return snapshot(job)
}

/** The answer to the math question. `careful` re-reads every pending page and every later math page
 *  with the math reader; `fast` keeps the fast reads. After the run it starts the re-read itself. */
export function decideTranscribeMath(file: string, choice: MathChoice): TranscribeJobState | null {
    if (choice !== 'careful' && choice !== 'fast') throw new AppError('EINVAL', 'choice must be careful or fast', 400)
    const job = jobs.get(file)
    if (!job) return null
    job.choice = choice
    if (choice === 'fast') job.state.mathPending = []
    else {
        // while the reading pass runs it re-reads the listed pages itself; after it, the follow-up does
        if (!job.reading) job.reread = [...new Set([...job.reread, ...job.state.mathPending])]
        job.state.mathPending = []
        if (job.state.state === 'done' && job.reread.length) {
            const pages = job.reread
            job.reread = []
            job.state.state = 'running'
            enqueue(job, () => followUp(job, pages))
        }
    }
    return snapshot(job)
}

/** The file's running job has finished its engine work (tests). */
export function transcribeJobSettled(file: string): Promise<void> {
    return jobs.get(file)?.settled ?? Promise.resolve()
}

/** Forget every job (tests). */
export function resetTranscribeJobs(): void {
    for (const j of jobs.values()) j.ctrl.abort()
    jobs.clear()
    queue = Promise.resolve()
}
