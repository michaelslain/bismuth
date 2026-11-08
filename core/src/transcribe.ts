// core/src/transcribe.ts
// Transcribe one image or pdf into its companion note. Shared by POST /transcribe and `bismuth
// transcribe` (which agents reach through bismuth_cli), so both run the same checks and write.
//
// The iPad runs core in-process, with no node:child_process: the engines are reached through
// dynamic import() only, so this file loads there, and a missing engine answers 503.
import { AppError } from './error'
import { companionPathFor, isImagePath, isPdfPath } from './fileKinds'
import { getFileAccess } from './fileAccess'
import { parseFrontmatter } from './frontmatter'
import { emptyPageChecks, onDeviceChecks, type ScoredLine } from './transcriptChecks'
import {
    readTranscript,
    writeApprovedCheck,
    writeTranscript,
    type TranscriptCheck,
    type PageText,
    type TranscribeEngine,
    type TranscriptEngine,
} from './transcript'
import { DEFAULTS } from './schema/settingsSchema'
import { addMarks, marksOnPage, removeMarks } from './bookMarks'
import type { TextLine } from './visionOcr'
import { looksLikeMath } from './mathDetect'
import type { TranscribePageState } from './transcribeJobTypes'

/** What auto does with a page that looks like math: re-read it (`careful`) or keep the fast read. */
export type MathChoice = 'careful' | 'fast'

export type TranscribeRequest = {
    file: string
    engine?: TranscribeEngine
    pages?: number[]
    book?: string
    onlyMissing?: boolean
    /** auto only; the `transcription.math` setting when omitted, where `ask` reads as `careful` unless
     *  the run has an `onMath` listener (a background job), which then asks mid-run. */
    math?: MathChoice
}

/** What a run reports and obeys beyond its request: the hooks a background job or `--progress` uses. */
export type TranscribeOpts = {
    mark?: (paths: string[]) => void
    settings?: TranscriptionSettings
    /** Abort stops the run: at once for marker, after the page in hand for on-device and ai. Rejects CANCELLED. */
    signal?: AbortSignal
    /** Present: the run goes page by page and reports every page state change (queued, reading, done, failed). */
    onPage?: (p: TranscribePageState) => void
    /** auto with `math` at `ask`: the math pages read fast and still waiting for a choice, whenever the list changes. */
    onMath?: (pages: number[]) => void
    /** auto with `math` at `ask`: the choice made so far, consulted after every page. */
    mathChoice?: () => MathChoice | undefined
    /** The math reader is not installed, so math pages went to ai. */
    onMarkerMissing?: () => void
}

export type TranscribeResult = {
    ok: true
    companion: string
    engine: TranscriptEngine
    pages: { page: number; chars: number }[]
    skipped?: true
    /** `auto` only: pages re-read after on-device, by marker (math) or ai (read poorly or not at all). */
    escalated?: number[]
    /** `auto` only: pages that look like math and still hold the on-device text. */
    math?: number[]
    /** `auto` only: why marker could not re-read the math pages (they went to ai instead). */
    markerSkipped?: string
    /** `auto` only: why pages stayed on-device text (ai was needed and could not run). */
    aiSkipped?: string
}

/** `auto` re-runs a page with ai when on-device confidence (0..1) is below this, or the text is blank. */
export const AUTO_AI_BELOW = 0.5

/** The `transcription` settings section as the transcriber reads it. */
export type TranscriptionSettings = {
    auto: boolean
    engine: TranscribeEngine
    math: 'ask' | MathChoice
    provider: string
    model: string
    /** `chat.provider`, which a `provider` of `auto` follows. */
    chatProvider?: unknown
}

export type RecognizedText = PageText & { confidence?: number; lines?: ScoredLine[] }

/** An on-device page as stored: its text, and a check for every line the fitted rule flags. */
function onDevicePage(rec: RecognizedText): PageText {
    const checks = onDeviceChecks(rec.lines)
    return checks.length ? { page: rec.page, text: rec.text, checks } : { page: rec.page, text: rec.text }
}

/** A math reader page as stored: flagged whole when it came back empty for a page with writing. */
function markerPage(page: number, text: string, onDeviceLines: number): PageText {
    const checks = emptyPageChecks(text, onDeviceLines)
    return checks.length ? { page, text, checks } : { page, text }
}
export type AiTarget = { provider: string; model?: string; chatProvider?: unknown }

export type StoredTranscript = { engine?: TranscriptEngine; at?: string; pages: PageText[] }

/** What each engine does with an absolute file path. Tests swap these; production loads the real ones. */
export type TranscribeEngines = {
    onDevice: (abs: string, kind: 'image' | 'pdf', pages?: number[]) => Promise<RecognizedText[]>
    ai: (abs: string, kind: 'image' | 'pdf', pages: number[] | undefined, target: AiTarget) => Promise<PageText[]>
    marker: (abs: string, kind: 'image' | 'pdf', pages?: number[], signal?: AbortSignal) => Promise<PageText[]>
    lines: (abs: string, pages?: number[]) => Promise<{ page: number; lines: TextLine[] }[]>
}

let override: Partial<TranscribeEngines> | null = null

/** Test seam: replace any of the engines for the process; null restores the real ones. */
export function setTranscribeEngines(engines: Partial<TranscribeEngines> | null): void {
    override = engines
}

const unavailable = (what: string) => new AppError('VISION_UNAVAILABLE', what, 503)

type VisionModule = {
    recognizePages: (abs: string, opts?: { pages?: number[] }) => Promise<RecognizedText[]>
    recognizeLines: (abs: string, opts?: { pages?: number[] }) => Promise<{ page: number; lines: TextLine[] }[]>
    renderPages: (abs: string, outDir: string, opts?: { pages?: number[] }) => Promise<{ page: number; path: string }[]>
}

async function loadVision(): Promise<VisionModule> {
    try {
        return (await import('./visionOcr')) as unknown as VisionModule
    } catch {
        throw unavailable('on-device text recognition needs the mac app')
    }
}

export type AiPageDeps = {
    aiTranscribe: (images: { page: number; path: string }[], target: AiTarget) => Promise<PageText[]>
    renderPages: (abs: string, outDir: string, opts?: { pages?: number[] }) => Promise<{ page: number; path: string }[]>
}

/** Render the pages to capped PNGs in a temp folder and send those to ai. An image the helper cannot
 *  render goes as the file itself only when it is already a png, jpeg, gif or webp; a pdf never does. */
export async function aiOnRenderedPages(
    abs: string,
    kind: 'image' | 'pdf',
    pages: number[] | undefined,
    target: AiTarget,
    deps: AiPageDeps,
): Promise<PageText[]> {
    const { mkdtemp, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'bismuth-pages-'))
    try {
        let images: { page: number; path: string }[]
        try {
            images = await deps.renderPages(abs, dir, { pages: kind === 'pdf' ? pages : undefined })
        } catch (e) {
            if (kind === 'pdf' || !/\.(png|jpe?g|gif|webp)$/i.test(abs)) throw e
            images = [{ page: 1, path: abs }]
        }
        return await deps.aiTranscribe(images, target)
    } finally {
        await rm(dir, { recursive: true, force: true })
    }
}

type AiModule = { aiTranscribe: AiPageDeps['aiTranscribe'] }
let loadAi: (() => Promise<AiModule>) | undefined

/** Desktop entry points register the ai transcriber with a literal import(), so a compiled
 *  binary embeds it; the iPad's in-process core registers none and answers AI_UNAVAILABLE.
 *  `undefined` clears it (tests). */
export function registerAiTranscriber(load: (() => Promise<AiModule>) | undefined): void {
    loadAi = load
}

const realEngines: TranscribeEngines = {
    onDevice: async (abs, _kind, pages) => (await loadVision()).recognizePages(abs, { pages }),
    lines: async (abs, pages) => (await loadVision()).recognizeLines(abs, { pages }),
    marker: async (abs, _kind, pages, signal) => {
        let mod: {
            markerPageTexts: (abs: string, pages?: number[], signal?: AbortSignal) => Promise<PageText[]>
        }
        try {
            mod = await import('./marker')
        } catch {
            throw new AppError('MARKER_UNAVAILABLE', 'marker runs only on the desktop', 503)
        }
        try {
            return await mod.markerPageTexts(abs, pages, signal)
        } catch (e) {
            // requireTool's ENOENT names the install command; the caller decides whether to fall back.
            if (e instanceof Error && (e as { code?: string }).code === 'ENOENT')
                throw new AppError('MARKER_UNAVAILABLE', e.message, 503)
            throw e
        }
    },
    ai: async (abs, kind, pages, target) => {
        if (!loadAi) throw new AppError('AI_UNAVAILABLE', 'ai transcription is not available here', 503)
        const mod = await loadAi()
        return aiOnRenderedPages(abs, kind, pages, target, {
            aiTranscribe: mod.aiTranscribe,
            renderPages: async (file, dir, opts) => (await loadVision()).renderPages(file, dir, opts),
        })
    },
}

function engineFor<K extends keyof TranscribeEngines>(engine: K): TranscribeEngines[K] {
    return (override?.[engine] ?? realEngines[engine]) as TranscribeEngines[K]
}

/** A vault-relative page path, or a throw: no traversal, no absolute path, an image or a pdf. */
export function checkPageFile(file: unknown): 'image' | 'pdf' {
    if (typeof file !== 'string' || file === '' || file.startsWith('/') || file.split('/').includes('..'))
        throw new AppError('EINVAL', 'file must be a vault-relative path', 400)
    if (isImagePath(file)) return 'image'
    if (isPdfPath(file)) return 'pdf'
    throw new AppError('UNSUPPORTED_FILE', `only images and PDFs can be transcribed: ${file}`, 422)
}

const ENGINE_NAMES: readonly string[] = ['auto', 'on-device', 'marker', 'ai']
const MATH_NAMES: readonly string[] = ['ask', 'careful', 'fast']

/** The vault's `transcription` settings over the schema defaults. Loads the settings reader on demand,
 *  because it is bound to Bun, which the iPad's in-process core lacks. */
export async function readTranscriptionSettings(root: string): Promise<TranscriptionSettings> {
    const d = (DEFAULTS as unknown as { transcription: Omit<TranscriptionSettings, 'chatProvider'> }).transcription
    let data: Record<string, unknown> = {}
    try {
        const { readSettings } = await import('./settings')
        data = (await readSettings(root))?.data ?? {}
    } catch {
        // no settings reader here: the defaults stand
    }
    const t = (data.transcription ?? {}) as Record<string, unknown>
    const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback)
    const engine = str(t.engine, d.engine)
    const math = str(t.math, d.math)
    return {
        auto: typeof t.auto === 'boolean' ? t.auto : d.auto,
        engine: (ENGINE_NAMES.includes(engine) ? engine : d.engine) as TranscribeEngine,
        math: (MATH_NAMES.includes(math) ? math : d.math) as TranscriptionSettings['math'],
        provider: str(t.provider, d.provider),
        model: str(t.model, d.model),
        chatProvider: (data.chat as { provider?: unknown } | undefined)?.provider,
    }
}

export async function transcribe(
    root: string,
    req: TranscribeRequest,
    opts: TranscribeOpts = {},
): Promise<TranscribeResult> {
    const kind = checkPageFile(req.file)
    if (req.engine !== undefined && !ENGINE_NAMES.includes(req.engine))
        throw new AppError('EINVAL', 'engine must be auto, on-device, marker or ai', 400)
    if (req.math !== undefined && req.math !== 'careful' && req.math !== 'fast')
        throw new AppError('EINVAL', 'math must be careful or fast', 400)
    const settings = opts.settings ?? (await readTranscriptionSettings(root))
    const requested: TranscribeEngine = req.engine ?? settings.engine
    const target: AiTarget = {
        provider: settings.provider,
        ...(settings.model ? { model: settings.model } : {}),
        chatProvider: settings.chatProvider,
    }
    const files = await getFileAccess()
    if (!(await files.statNote(root, req.file))) throw new AppError('ENOENT', `no such file: ${req.file}`, 404)
    const companion = companionPathFor(req.file)
    if (req.onlyMissing && !opts.onPage) {
        const current = await files.readNote(root, companion).catch(() => '')
        if (current && parseFrontmatter(current).data.transcribed)
            return { ok: true, companion, engine: requested === 'auto' ? 'on-device' : requested, skipped: true, pages: [] }
    }
    const abs = `${root.replace(/\/+$/, '')}/${req.file}`
    throwIfCancelled(opts.signal)
    if (opts.onPage) {
        const pager = createPager(root, req, opts, { kind, abs, companion, target, settings, requested })
        return pager.run()
    }
    let pages: PageText[]
    let engine: TranscriptEngine
    let auto: AutoRun | undefined
    if (requested === 'ai') {
        engine = 'ai'
        pages = await engineFor('ai')(abs, kind, req.pages, target)
    } else if (requested === 'marker') {
        engine = 'marker'
        pages = await engineFor('marker')(abs, kind, req.pages, opts.signal)
        throwIfCancelled(opts.signal)
    } else if (requested === 'on-device') {
        engine = 'on-device'
        pages = (await engineFor('onDevice')(abs, kind, req.pages)).map(onDevicePage)
    } else {
        const math: MathChoice = (req.math ?? settings.math) === 'fast' ? 'fast' : 'careful'
        auto = await transcribeAuto(abs, kind, req.pages, target, math, opts.signal)
        pages = auto.pages
        engine = auto.engine
    }
    // A run limited to some pages replaces only those pages; the rest of the stored transcript stays.
    let out = pages
    if (req.pages?.length) {
        const prev = readTranscript(await files.readNote(root, companion).catch(() => ''))
        const got = new Set(pages.map(p => p.page))
        out = [...prev.filter(p => !got.has(p.page)), ...pages].sort((a, b) => a.page - b.page)
    }
    await writeTranscript(root, companion, out, engine, kind, { book: req.book, mark: opts.mark })
    return {
        ok: true,
        companion,
        engine,
        pages: pages.map(p => ({ page: p.page, chars: p.text.length })),
        ...(auto?.escalated.length ? { escalated: auto.escalated } : {}),
        ...(auto?.math.length ? { math: auto.math } : {}),
        ...(auto?.markerSkipped ? { markerSkipped: auto.markerSkipped } : {}),
        ...(auto?.aiSkipped ? { aiSkipped: auto.aiSkipped } : {}),
    }
}

type AutoRun = {
    pages: PageText[]
    engine: TranscriptEngine
    escalated: number[]
    math: number[]
    markerSkipped?: string
    aiSkipped?: string
}

function throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AppError('CANCELLED', 'transcribe cancelled', 499)
}

const why = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** On-device first. A page that looks like math goes to marker when `math` is careful (ai where
 *  marker cannot run); any other page read below AUTO_AI_BELOW, or blank, goes to ai. A failed
 *  re-read keeps the on-device text and says why. With no on-device helper, every page goes to
 *  marker, then ai. */
async function transcribeAuto(
    abs: string,
    kind: 'image' | 'pdf',
    wanted: number[] | undefined,
    target: AiTarget,
    math: MathChoice,
    signal?: AbortSignal,
): Promise<AutoRun> {
    let read: RecognizedText[]
    try {
        read = await engineFor('onDevice')(abs, kind, wanted)
    } catch (e) {
        if (!(e instanceof AppError) || e.code !== 'VISION_UNAVAILABLE') throw e
        try {
            const pages = await engineFor('marker')(abs, kind, wanted, signal)
            return { pages, engine: 'marker', escalated: pages.map(p => p.page), math: [] }
        } catch (m) {
            if (!(m instanceof AppError) || m.code !== 'MARKER_UNAVAILABLE') throw m
            const pages = await engineFor('ai')(abs, kind, wanted, target)
            return { pages, engine: 'ai', escalated: pages.map(p => p.page), math: [] }
        }
    }
    const mathPages = read.filter(p => looksLikeMath(p.text)).map(p => p.page)
    const hard = read
        .filter(p => !mathPages.includes(p.page))
        .filter(p => p.text.trim() === '' || (p.confidence !== undefined && p.confidence < AUTO_AI_BELOW))
        .map(p => p.page)
    const redone = new Map<number, { page: PageText; by: 'marker' | 'ai' }>()
    const linesOn = (n: number) => read.find(p => p.page === n)?.lines?.length ?? 0
    let markerSkipped: string | undefined
    let aiSkipped: string | undefined
    if (math === 'careful' && mathPages.length) {
        try {
            for (const p of await engineFor('marker')(abs, kind, mathPages, signal))
                if (mathPages.includes(p.page)) redone.set(p.page, { page: markerPage(p.page, p.text, linesOn(p.page)), by: 'marker' })
        } catch (e) {
            throwIfCancelled(signal)
            markerSkipped = why(e)
        }
        for (const n of mathPages) if (!redone.has(n)) hard.push(n)
    }
    if (hard.length) {
        try {
            for (const p of await engineFor('ai')(abs, kind, hard, target))
                if (hard.includes(p.page)) redone.set(p.page, { page: p, by: 'ai' })
        } catch (e) {
            aiSkipped = why(e)
        }
    }
    const by = [...redone.values()].map(r => r.by)
    return {
        pages: read.map(r => redone.get(r.page)?.page ?? onDevicePage(r)),
        engine: by.includes('ai') ? 'ai' : by.includes('marker') ? 'marker' : 'on-device',
        escalated: read.map(p => p.page).filter(n => redone.has(n)),
        math: mathPages.filter(n => !redone.has(n)),
        ...(markerSkipped ? { markerSkipped } : {}),
        ...(aiSkipped ? { aiSkipped } : {}),
    }
}

const companionLocks = new Map<string, Promise<unknown>>()
/** Run `fn` after every earlier write to the same companion note finished, so a read-modify-write
 *  of one page never undoes another. */
export function withCompanion<T>(rel: string, fn: () => Promise<T>): Promise<T> {
    const run = (companionLocks.get(rel) ?? Promise.resolve()).then(fn, fn)
    companionLocks.set(rel, run.catch(() => {}))
    return run
}

/** The transcript stored in a page file's companion; `{ pages: [] }` when there is none. */
export async function readStoredTranscript(root: string, file: string): Promise<StoredTranscript> {
    checkPageFile(file)
    const files = await getFileAccess()
    const md = await files.readNote(root, companionPathFor(file)).catch(() => '')
    const pages = readTranscript(md)
    if (pages.length === 0) return { pages: [] }
    const { data } = parseFrontmatter(md)
    const engine = data.transcribed === 'on-device' || data.transcribed === 'marker' || data.transcribed === 'ai' ? data.transcribed : undefined
    const at = data.transcribedAt instanceof Date ? data.transcribedAt.toISOString() : typeof data.transcribedAt === 'string' ? data.transcribedAt : undefined
    return { ...(engine ? { engine } : {}), ...(at ? { at } : {}), pages }
}

export type MarkRequest = { file: string; page?: number; add?: string[]; remove?: string[] }

/** Mark or unmark quotes in one page's transcript and write the companion back. */
export async function markTranscript(
    root: string,
    req: MarkRequest,
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<{ ok: true; companion: string; marks: string[] }> {
    checkPageFile(req.file)
    const page = req.page ?? 1
    if (!Number.isInteger(page) || page < 1) throw new AppError('EINVAL', 'page must be a positive integer', 400)
    const strings = (v: unknown): string[] | null =>
        v === undefined ? [] : Array.isArray(v) && v.every(q => typeof q === 'string') ? (v as string[]) : null
    const add = strings(req.add)
    const remove = strings(req.remove)
    if (!add || !remove) throw new AppError('EINVAL', 'add and remove must be lists of strings', 400)
    const files = await getFileAccess()
    const companion = companionPathFor(req.file)
    return withCompanion(companion, async () => {
        const current = await files.readNote(root, companion).catch(() => '')
        if (readTranscript(current).length === 0) throw new AppError('ENOENT', `no transcript for ${req.file}`, 404)
        const next = addMarks(removeMarks(current, page, remove), page, add)
        if (next !== current) {
            opts.mark?.([companion])
            await files.writeNote(root, companion, next)
        }
        return { ok: true as const, companion, marks: marksOnPage(next, page) }
    })
}

export type ApproveCheckRequest = { file: string; page?: number; line?: string }

/** Clear one review check on a page: the line whose text matches `line`, or the whole-page check when
 *  `line` is empty. The text is left as it is. Answers the page's checks still standing. */
export async function approveTranscriptCheck(
    root: string,
    req: ApproveCheckRequest,
    opts: { mark?: (paths: string[]) => void } = {},
): Promise<{ ok: true; companion: string; checks: TranscriptCheck[] }> {
    const kind = checkPageFile(req.file)
    const page = req.page ?? 1
    if (!Number.isInteger(page) || page < 1) throw new AppError('EINVAL', 'page must be a positive integer', 400)
    if (req.line !== undefined && typeof req.line !== 'string') throw new AppError('EINVAL', 'line must be a string', 400)
    const files = await getFileAccess()
    if (!(await files.statNote(root, req.file))) throw new AppError('ENOENT', `no such file: ${req.file}`, 404)
    const companion = companionPathFor(req.file)
    const checks = await withCompanion(companion, () =>
        writeApprovedCheck(root, companion, page, req.line ?? '', kind, { mark: opts.mark }),
    )
    return { ok: true, companion, checks }
}

/** Recognise a page file again with line boxes. Nothing is stored. */
export async function transcriptLines(
    root: string,
    req: { file: string; pages?: number[] },
): Promise<{ pages: { page: number; lines: TextLine[] }[] }> {
    checkPageFile(req.file)
    const files = await getFileAccess()
    if (!(await files.statNote(root, req.file))) throw new AppError('ENOENT', `no such file: ${req.file}`, 404)
    const abs = `${root.replace(/\/+$/, '')}/${req.file}`
    return { pages: await engineFor('lines')(abs, req.pages) }
}

type PagerCtx = {
    kind: 'image' | 'pdf'
    abs: string
    companion: string
    target: AiTarget
    settings: TranscriptionSettings
    requested: TranscribeEngine
}

const isUnavailable = (e: unknown) =>
    e instanceof AppError && (e.code === 'VISION_UNAVAILABLE' || e.code === 'AI_UNAVAILABLE')

/** `pages` minus those the companion already holds text for (what `onlyMissing` means for a paged run). */
export async function pagesWithoutText(root: string, companion: string, pages: number[]): Promise<number[]> {
    const have = new Set(
        readTranscript(await (await getFileAccess()).readNote(root, companion).catch(() => ''))
            .filter(p => p.text.trim())
            .map(p => p.page),
    )
    return pages.filter(n => !have.has(n))
}

/** The page-by-page runner behind a background job and `--progress`: reports every page state
 *  change through `opts.onPage` and writes each finished page to the companion before the next one
 *  starts, so the stored transcript always shows the pages done so far. */
function createPager(root: string, req: TranscribeRequest, opts: TranscribeOpts, ctx: PagerCtx) {
    const { kind, abs, companion, target, settings } = ctx
    const states = new Map<number, TranscribePageState>()
    const started = new Map<number, number>()
    const texts = new Map<number, string>()
    let lastEngine: TranscriptEngine = 'on-device'
    const redoneBy = new Set<TranscriptEngine>()
    let markerSkipped: string | undefined
    let aiSkipped: string | undefined
    const escalated = new Set<number>()
    let askPending: number[] = []
    const check = () => throwIfCancelled(opts.signal)

    const emit = (page: number, patch: Partial<TranscribePageState>) => {
        const prev: TranscribePageState = states.get(page) ?? { page, status: 'queued' }
        const next: TranscribePageState = { ...prev, ...patch }
        if (patch.status === 'reading') {
            started.set(page, Date.now())
            delete next.error
        }
        if (patch.status === 'done') next.ms = Date.now() - (started.get(page) ?? Date.now())
        states.set(page, next)
        opts.onPage?.({ ...next })
    }

    /** Store one page's text now: read the stored transcript, replace the page, write it back. */
    const save = async (got: PageText, engine: TranscriptEngine) => {
        const { page, text } = got
        check()
        const files = await getFileAccess()
        await withCompanion(companion, async () => {
            const prev = readTranscript(await files.readNote(root, companion).catch(() => ''))
            const merged = [...prev.filter(p => p.page !== page), got].sort((a, b) => a.page - b.page)
            await writeTranscript(root, companion, merged, engine, kind, { book: req.book, mark: opts.mark })
        })
        texts.set(page, text)
        lastEngine = engine
    }

    const readOnDevice = async (n: number): Promise<RecognizedText> => {
        const r = await engineFor('onDevice')(abs, kind, kind === 'pdf' ? [n] : undefined)
        return r.find(p => p.page === n) ?? r[0] ?? { page: n, text: '' }
    }
    const readAi = async (n: number): Promise<PageText> => {
        const r = await engineFor('ai')(abs, kind, kind === 'pdf' ? [n] : undefined, target)
        const got = r.find(p => p.page === n) ?? r[0]
        return got ? { ...got, page: n } : { page: n, text: '' }
    }
    /** How many lines the on-device pass found on each page this run read, for the math reader's empty-page check. */
    const onDeviceLines = new Map<number, number>()

    /** One page by ai: done on success; on failure the page keeps `fallback` text when it has some. */
    const aiPage = async (n: number, hadText: boolean): Promise<void> => {
        emit(n, { status: 'reading', engine: 'ai' })
        try {
            const got = await readAi(n)
            check()
            await save(got, 'ai')
            redoneBy.add('ai')
            escalated.add(n)
            emit(n, { status: 'done', engine: 'ai' })
        } catch (e) {
            check()
            if (!hadText) {
                emit(n, { status: 'failed', error: why(e) })
                if (isUnavailable(e)) throw e
                return
            }
            aiSkipped = why(e)
            emit(n, { status: 'done', engine: 'on-device' })
        }
    }

    /** Re-read pages with the math reader as one batch (ai page by page where it cannot run). */
    const rereadMath = async (pages: number[]): Promise<void> => {
        if (!pages.length) return
        for (const n of pages) emit(n, { status: 'reading', engine: 'marker' })
        const got = new Map<number, string>()
        try {
            for (const p of await engineFor('marker')(abs, kind, pages, opts.signal))
                if (pages.includes(p.page)) got.set(p.page, p.text)
            check()
        } catch (e) {
            check()
            markerSkipped = why(e)
            if (e instanceof AppError && e.code === 'MARKER_UNAVAILABLE') opts.onMarkerMissing?.()
        }
        for (const n of pages) {
            if (!got.has(n)) continue
            await save(markerPage(n, got.get(n)!, onDeviceLines.get(n) ?? 0), 'marker')
            redoneBy.add('marker')
            escalated.add(n)
            emit(n, { status: 'done', engine: 'marker' })
        }
        for (const n of pages) if (!got.has(n)) await aiPage(n, texts.has(n))
    }

    const pageList = async (): Promise<number[]> => {
        if (kind === 'image') return [1]
        if (req.pages?.length) return [...new Set(req.pages)].sort((a, b) => a - b)
        const { pdfPageCount } = await import('./pdfPages')
        const count = (await pdfPageCount(root, req.file)).pages
        return Array.from({ length: count }, (_, i) => i + 1)
    }

    const finish = (pages: number[]): TranscribeResult => ({
        ok: true,
        companion,
        engine: lastEngine,
        pages: pages.filter(n => texts.has(n)).map(n => ({ page: n, chars: texts.get(n)!.length })),
        ...(escalated.size ? { escalated: [...escalated].sort((a, b) => a - b) } : {}),
        ...(askPending.length ? { math: askPending } : {}),
        ...(markerSkipped ? { markerSkipped } : {}),
        ...(aiSkipped ? { aiSkipped } : {}),
    })

    /** Every page one at a time with one engine; a page that fails is reported and the run goes on. */
    const single = async (pages: number[], read: (n: number) => Promise<PageText>, engine: TranscriptEngine) => {
        for (const n of pages) {
            check()
            emit(n, { status: 'reading', engine })
            try {
                await save(await read(n), engine)
                emit(n, { status: 'done', engine })
            } catch (e) {
                check()
                emit(n, { status: 'failed', error: why(e) })
                if (isUnavailable(e)) throw e
            }
        }
        if (!pages.some(n => texts.has(n))) {
            const failed = states.get(pages[0])?.error
            throw new AppError('INTERNAL_ERROR', failed ?? 'no page could be read', 500)
        }
    }

    const markerBatch = async (pages: number[]) => {
        for (const n of pages) emit(n, { status: 'reading', engine: 'marker' })
        let got: PageText[]
        try {
            got = await engineFor('marker')(abs, kind, req.pages?.length ? pages : undefined, opts.signal)
        } catch (e) {
            check()
            for (const n of pages) emit(n, { status: 'failed', error: why(e) })
            throw e
        }
        check()
        for (const p of got) {
            if (!pages.includes(p.page)) continue
            await save(markerPage(p.page, p.text, onDeviceLines.get(p.page) ?? 0), 'marker')
            emit(p.page, { status: 'done', engine: 'marker' })
        }
        for (const n of pages) if (!texts.has(n)) emit(n, { status: 'failed', error: 'no text came back' })
    }

    const auto = async (pages: number[]) => {
        const base = req.math ?? settings.math
        const asking = base === 'ask' && !!opts.onMath
        const fixed: MathChoice = base === 'fast' ? 'fast' : 'careful'
        const careful: number[] = []
        const afterPage = () => {
            if (!askPending.length) return
            const c = opts.mathChoice?.()
            if (!c) return
            if (c === 'careful') careful.push(...askPending)
            askPending = []
            opts.onMath?.([])
        }
        for (const n of pages) {
            check()
            emit(n, { status: 'reading', engine: 'on-device' })
            let rec: RecognizedText
            try {
                rec = await readOnDevice(n)
            } catch (e) {
                check()
                if (e instanceof AppError && e.code === 'VISION_UNAVAILABLE' && n === pages[0]) {
                    // no on-device helper: the math reader reads the whole run, then ai takes what it cannot
                    try {
                        await markerBatch(pages)
                    } catch (m) {
                        check()
                        if (!(m instanceof AppError) || m.code !== 'MARKER_UNAVAILABLE') throw m
                        opts.onMarkerMissing?.()
                        for (const p of pages) await aiPage(p, false)
                    }
                    return
                }
                emit(n, { status: 'failed', error: why(e) })
                continue
            }
            check()
            const math = looksLikeMath(rec.text)
            const hard = !math && (rec.text.trim() === '' || (rec.confidence !== undefined && rec.confidence < AUTO_AI_BELOW))
            onDeviceLines.set(n, rec.lines?.length ?? 0)
            await save(onDevicePage({ ...rec, page: n }), 'on-device')
            if (hard) await aiPage(n, true)
            else if (!math) emit(n, { status: 'done', engine: 'on-device' })
            else if (asking && !opts.mathChoice?.()) {
                askPending.push(n)
                opts.onMath?.([...askPending])
                emit(n, { status: 'done', engine: 'on-device' })
            } else if ((asking ? opts.mathChoice?.() : fixed) === 'careful') {
                careful.push(n)
                emit(n, { status: 'queued' })
            }
            else emit(n, { status: 'done', engine: 'on-device' })
            afterPage()
        }
        check()
        await rereadMath(careful)
    }

    return {
        async run(): Promise<TranscribeResult> {
            const all = await pageList()
            const pages = req.onlyMissing ? await pagesWithoutText(root, companion, all) : all
            if (!pages.length) return { ok: true, companion, engine: 'on-device', skipped: true, pages: [] }
            for (const n of pages) emit(n, { status: 'queued' })
            if (ctx.requested === 'marker') await markerBatch(pages)
            else if (ctx.requested === 'ai') await single(pages, readAi, 'ai')
            else if (ctx.requested === 'on-device') await single(pages, async n => onDevicePage({ ...(await readOnDevice(n)), page: n }), 'on-device')
            else await auto(pages)
            return finish(pages)
        },
        /** Re-read already stored pages with the math reader (a choice that came after the run). */
        async math(pages: number[]): Promise<TranscribeResult> {
            const files = await getFileAccess()
            for (const p of readTranscript(await files.readNote(root, companion).catch(() => ''))) {
                texts.set(p.page, p.text)
                // the stored on-device text's lines stand for the lines that pass found
                onDeviceLines.set(p.page, p.text.split('\n').filter(l => l.trim()).length)
            }
            await rereadMath(pages)
            return finish(pages)
        },
    }
}

/** Re-read `pages` with the math reader (ai where it cannot run), reporting through the same hooks as
 *  a paged run. Used when the math choice arrives after the reading pass. */
export async function transcribeMathPages(
    root: string,
    req: TranscribeRequest,
    pages: number[],
    opts: TranscribeOpts,
): Promise<TranscribeResult> {
    const kind = checkPageFile(req.file)
    const settings = opts.settings ?? (await readTranscriptionSettings(root))
    const target: AiTarget = {
        provider: settings.provider,
        ...(settings.model ? { model: settings.model } : {}),
        chatProvider: settings.chatProvider,
    }
    const pager = createPager(root, req, opts, {
        kind,
        abs: `${root.replace(/\/+$/, '')}/${req.file}`,
        companion: companionPathFor(req.file),
        target,
        settings,
        requested: 'auto',
    })
    return pager.math(pages)
}
