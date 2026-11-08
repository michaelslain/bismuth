// app/src/bases/transcription.ts
// The reader's transcription controller. A transcription is a background job on the server (one per
// file); this polls the jobs the reader started, folds them into one progress across every file it
// holds, answers the mid-run math question, and installs the math reader when a careful read needs
// it. Signals only, no components, so a story and a test drive it with a fake client.
import { createSignal } from 'solid-js'
import type { api } from '../api'
import type { TranscribeEngine } from '../../../core/src/transcript'
import type { TranscribeJobState, TranscribePageState } from '../../../core/src/transcribeJobTypes'

export type TranscribeJobClient = Pick<
    typeof api,
    'startTranscribeJob' | 'transcribeJob' | 'cancelTranscribeJob' | 'decideTranscribeMath' | 'markerSetup' | 'startMarkerSetup'
>

export type Transcription = {
    /** per file: the job's state for one page (undefined when no job covers it) */
    pageState(file: string, page: number): TranscribePageState | undefined
    /** across every file the reader holds: pages done (incl. failed) / pages in running jobs, ms left; undefined when nothing runs */
    progress(): { done: number; total: number; etaMs?: number; page?: number } | undefined
    /** auto + button runs (fill gaps), and redo of one page with a chosen engine */
    start(file: string, opts?: { pages?: number[]; engine?: TranscribeEngine }): void
    cancel(): void
    /** pick up a job the server already runs for `file` (a remount mid-run): progress and cancel work again */
    adopt(file: string): void
    /** pages awaiting the math choice, across files; 0 hides the prompt */
    mathPending(): number
    markerMissing(): boolean
    installing(): boolean
    chooseMath(choice: 'careful' | 'fast', remember: boolean): void
    /** fires after a job wrote pages, so the reader reloads that file's transcript */
    onWrote(fn: (file: string) => void): () => void
    dispose(): void
}

export type TranscriptionOptions = {
    client: TranscribeJobClient
    book?: string
    math: () => 'ask' | 'careful' | 'fast'
    setMath: (m: 'careful' | 'fast') => void
    toast: (msg: string) => void
    /** poll interval; stories pass a tiny one or drive `tick()` */
    pollMs?: number
}

/** The controller plus what the reader's effects need: `tick` polls once, `auto` is the
 *  fill-the-gaps run tried once per file a session (silent on failure), `storedMath` the once-per-file
 *  check of pages an earlier on-device read left with formulas, by the same `transcription.math` rule. */
export type TranscriptionController = Transcription & {
    tick(): Promise<void>
    auto(file: string): void
    storedMath(file: string, pages: number[]): void
}

const fileName = (file: string) => file.split('/').pop() || file
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const finished = (p: TranscribePageState) => p.status === 'done' || p.status === 'failed'
const doneCount = (j: TranscribeJobState) => j.pages.filter(p => p.status === 'done').length

/** `transcribing 4 of 12 // about 2 min left`; `transcribing 1 of 12` before an estimate exists. */
export function progressReadout(p: { done: number; total: number; etaMs?: number; page?: number }): string {
    if (p.total === 0) return 'transcribing'
    // a one-page re-read names its page; "1 of 1" would read as a one-page file
    const head = p.page !== undefined && p.total === 1 ? `transcribing page ${p.page}` : `transcribing ${Math.min(p.total, p.done + 1)} of ${p.total}`
    if (p.etaMs === undefined) return head
    if (p.etaMs < 60_000) return `${head} // under a minute left`
    return `${head} // about ${Math.round(p.etaMs / 60_000)} min left`
}

export function createTranscription(opts: TranscriptionOptions): TranscriptionController {
    const { client } = opts
    const [jobs, setJobs] = createSignal<ReadonlyMap<string, TranscribeJobState>>(new Map())
    // math pages found by the stored-transcript check: no job holds them, so they wait here
    const [localMath, setLocalMath] = createSignal<ReadonlyMap<string, number[]>>(new Map())
    const [localMissing, setLocalMissing] = createSignal(false)
    const [installed, setInstalled] = createSignal(false)
    const [installing, setInstalling] = createSignal(false)
    // files whose math choice is on its way to the server: their pending pages no longer count
    const [deciding, setDeciding] = createSignal<ReadonlySet<string>>(new Set())
    const wrote = new Set<(file: string) => void>()
    const explicit = new Set<string>()
    const storedChecked = new Set<string>()
    const autoTried = new Set<string>()
    // redos asked for while the file's job runs: the server would hand back the running job, so they wait for it to end
    const deferred = new Map<string, { pages?: number[]; engine?: TranscribeEngine }[]>()
    let timer: ReturnType<typeof setInterval> | undefined
    let installPoll: ReturnType<typeof setInterval> | undefined
    let disposed = false
    // files seen running since the last idle moment: progress counts them whatever their state now
    const batch = new Set<string>()
    // the math choice made during this batch: files started later in it inherit it
    let batchChoice: 'careful' | 'fast' | undefined

    const running = () => [...jobs().values()].filter(j => j.state === 'running')

    function apply(state: TranscribeJobState) {
        const prev = jobs().get(state.file)
        if (state.state === 'running') batch.add(state.file)
        setJobs(m => new Map(m).set(state.file, state))
        if (!prev || doneCount(state) > doneCount(prev)) {
            if (doneCount(state) > (prev ? doneCount(prev) : 0)) wrote.forEach(fn => fn(state.file))
        }
        if (prev?.state === 'running' && state.state === 'failed' && explicit.has(state.file))
            opts.toast(state.error ?? `transcribing ${fileName(state.file)} failed`)
        if (state.state !== 'running') explicit.delete(state.file)
        if (prev?.state === 'running' && state.state !== 'running') {
            const queued = deferred.get(state.file)
            deferred.delete(state.file)
            for (const entry of queued ?? []) void run(state.file, entry, true)
        }
        if (running().length > 0) arm()
        else {
            disarm()
            batch.clear()
            batchChoice = undefined
        }
    }

    function arm() {
        if (timer || disposed) return
        timer = setInterval(() => void tick(), opts.pollMs ?? 1000)
    }
    function disarm() {
        clearInterval(timer)
        timer = undefined
    }

    async function tick() {
        await Promise.all(
            running().map(async j => {
                try {
                    const s = await client.transcribeJob(j.file)
                    if (s) apply(s)
                } catch {
                    // a missed poll is retried on the next one
                }
            }),
        )
    }

    async function run(file: string, body: { pages?: number[]; engine?: TranscribeEngine; math?: 'careful' | 'fast' }, loud: boolean) {
        if (loud) explicit.add(file)
        try {
            apply(
                await client.startTranscribeJob({
                    file,
                    ...(opts.book ? { book: opts.book } : {}),
                    ...(body.engine ? { engine: body.engine } : {}),
                    ...(body.pages ? { pages: body.pages } : {}),
                    // an automatic or button run fills the gaps; a redo replaces its pages
                    ...(body.engine || body.pages ? {} : { onlyMissing: true }),
                    ...(body.engine ? {} : { math: body.math ?? batchChoice ?? opts.math() }),
                }),
            )
        } catch (e) {
            explicit.delete(file)
            if (loud) opts.toast(message(e))
        }
    }

    /** Install the math reader, then run `then`: a failed install says why and runs it anyway
     *  (math pages then go to ai). */
    function install(then: () => void) {
        setInstalling(true)
        const finish = (error?: string) => {
            clearInterval(installPoll)
            setInstalling(false)
            if (error) opts.toast(`the math reader did not install: ${error}`)
            else setInstalled(true)
            then()
        }
        void client.startMarkerSetup().then(
            first => {
                if (first.state === 'done') return finish()
                if (first.state === 'failed') return finish(first.error)
                installPoll = setInterval(() => {
                    void client.markerSetup().then(s => {
                        if (s.job.state === 'done') finish()
                        else if (s.job.state === 'failed') finish(s.job.error)
                    })
                }, 2000)
            },
            e => finish(message(e)),
        )
    }

    const pendingIn = (j: TranscribeJobState) => (deciding().has(j.file) ? 0 : j.mathPending.length)
    const mathPending = () =>
        [...jobs().values()].reduce((n, j) => n + pendingIn(j), 0) +
        [...localMath().values()].reduce((n, p) => n + p.length, 0)
    const markerMissing = () =>
        !installed() && (localMissing() || [...jobs().values()].some(j => pendingIn(j) > 0 && j.markerMissing))

    return {
        pageState: (file, page) => {
            const j = jobs().get(file)
            const p = j?.pages.find(x => x.page === page)
            // a stopped or failed job leaves the pages it never read as not transcribed
            return p && (j!.state === 'running' || finished(p)) ? p : undefined
        },
        progress: () => {
            const live = running()
            if (live.length === 0) return undefined
            const mine = [...jobs().values()].filter(j => batch.has(j.file))
            const etas = live.map(j => j.etaMs).filter((e): e is number => e !== undefined)
            const total = mine.reduce((n, j) => n + j.pages.length, 0)
            const only = total === 1 ? mine.flatMap(j => j.pages)[0] : undefined
            return {
                done: mine.reduce((n, j) => n + j.pages.filter(finished).length, 0),
                total,
                ...(only ? { page: only.page } : {}),
                ...(etas.length ? { etaMs: etas.reduce((a, b) => a + b, 0) } : {}),
            }
        },
        start(file, o = {}) {
            if ((o.engine || o.pages) && jobs().get(file)?.state === 'running') {
                deferred.set(file, [...(deferred.get(file) ?? []), o])
                return
            }
            void run(file, o, true)
        },
        auto(file) {
            if (autoTried.has(file)) return
            autoTried.add(file)
            void run(file, {}, false)
        },
        storedMath(file, pages) {
            // a running job's own math pages are already its pending list
            if (jobs().has(file)) return
            if (storedChecked.has(file) || pages.length === 0) return
            storedChecked.add(file)
            const setting = opts.math()
            if (setting === 'fast') return
            if (setting === 'careful') return void run(file, { pages, math: 'careful' }, false)
            setLocalMath(m => new Map(m).set(file, [...new Set([...(m.get(file) ?? []), ...pages])]))
            void client.markerSetup().then(
                s => setLocalMissing(!s.installed),
                () => setLocalMissing(false),
            )
        },
        adopt(file) {
            void client.transcribeJob(file).then(
                s => {
                    if (!s) return
                    apply(s)
                    // one click starts a book's files together: finished jobs started with the earliest running one stay in the batch
                    const live = running()
                    if (live.length === 0) return
                    const first = Math.min(...live.map(j => j.startedAt))
                    for (const j of jobs().values()) if (j.state !== 'running' && j.startedAt >= first - 1000) batch.add(j.file)
                },
                () => undefined,
            )
        },
        cancel() {
            for (const j of running()) {
                void client.cancelTranscribeJob(j.file).then(
                    s => {
                        apply(s)
                        opts.toast(`stopped transcribing ${fileName(j.file)}`)
                    },
                    e => opts.toast(message(e)),
                )
            }
        },
        mathPending,
        markerMissing,
        installing,
        chooseMath(choice, remember) {
            if (remember) opts.setMath(choice)
            batchChoice = choice
            const needInstall = choice === 'careful' && markerMissing()
            const files = [...jobs().values()].filter(j => pendingIn(j) > 0 || j.state === 'running').map(j => j.file)
            const stored = localMath()
            setLocalMath(new Map())
            setDeciding(new Set(files))
            const go = async () => {
                for (const f of files) {
                    try {
                        apply(await client.decideTranscribeMath(f, choice))
                    } catch (e) {
                        opts.toast(message(e))
                    }
                }
                setDeciding(new Set<string>())
                if (choice === 'careful')
                    for (const [f, pages] of stored) await run(f, { pages, math: 'careful' }, true)
            }
            if (needInstall) install(() => void go())
            else void go()
        },
        onWrote(fn) {
            wrote.add(fn)
            return () => wrote.delete(fn)
        },
        dispose() {
            disposed = true
            disarm()
            deferred.clear()
            clearInterval(installPoll)
            wrote.clear()
        },
        tick,
    }
}
