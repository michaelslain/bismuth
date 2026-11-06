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
import {
    readTranscript,
    writeTranscript,
    type PageText,
    type TranscribeEngine,
    type TranscriptEngine,
} from './transcript'
import { DEFAULTS } from './schema/settingsSchema'
import { addMarks, marksOnPage, removeMarks } from './bookMarks'
import type { TextLine } from './visionOcr'
import { looksLikeMath } from './mathDetect'

/** What auto does with a page that looks like math: re-read it (`careful`) or keep the fast read. */
export type MathChoice = 'careful' | 'fast'

export type TranscribeRequest = {
    file: string
    engine?: TranscribeEngine
    pages?: number[]
    book?: string
    onlyMissing?: boolean
    /** auto only; the `transcription.math` setting when omitted, where `ask` reads as `careful`. */
    math?: MathChoice
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

export type RecognizedText = PageText & { confidence?: number }
export type AiTarget = { provider: string; model?: string; chatProvider?: unknown }

export type StoredTranscript = { engine?: TranscriptEngine; at?: string; pages: PageText[] }

/** What each engine does with an absolute file path. Tests swap these; production loads the real ones. */
export type TranscribeEngines = {
    onDevice: (abs: string, kind: 'image' | 'pdf', pages?: number[]) => Promise<RecognizedText[]>
    ai: (abs: string, kind: 'image' | 'pdf', pages: number[] | undefined, target: AiTarget) => Promise<PageText[]>
    marker: (abs: string, kind: 'image' | 'pdf', pages?: number[]) => Promise<PageText[]>
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
    marker: async (abs, _kind, pages) => {
        let mod: { markerPageTexts: (abs: string, pages?: number[]) => Promise<PageText[]> }
        try {
            mod = await import('./marker')
        } catch {
            throw new AppError('MARKER_UNAVAILABLE', 'marker runs only on the desktop', 503)
        }
        try {
            return await mod.markerPageTexts(abs, pages)
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
    opts: { mark?: (paths: string[]) => void; settings?: TranscriptionSettings } = {},
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
    if (req.onlyMissing) {
        const current = await files.readNote(root, companion).catch(() => '')
        if (current && parseFrontmatter(current).data.transcribed)
            return { ok: true, companion, engine: requested === 'auto' ? 'on-device' : requested, skipped: true, pages: [] }
    }
    const abs = `${root.replace(/\/+$/, '')}/${req.file}`
    let pages: PageText[]
    let engine: TranscriptEngine
    let auto: AutoRun | undefined
    if (requested === 'ai') {
        engine = 'ai'
        pages = await engineFor('ai')(abs, kind, req.pages, target)
    } else if (requested === 'marker') {
        engine = 'marker'
        pages = await engineFor('marker')(abs, kind, req.pages)
    } else if (requested === 'on-device') {
        engine = 'on-device'
        pages = (await engineFor('onDevice')(abs, kind, req.pages)).map(({ page, text }) => ({ page, text }))
    } else {
        const math: MathChoice = req.math ?? (settings.math === 'fast' ? 'fast' : 'careful')
        auto = await transcribeAuto(abs, kind, req.pages, target, math)
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
): Promise<AutoRun> {
    let read: RecognizedText[]
    try {
        read = await engineFor('onDevice')(abs, kind, wanted)
    } catch (e) {
        if (!(e instanceof AppError) || e.code !== 'VISION_UNAVAILABLE') throw e
        try {
            const pages = await engineFor('marker')(abs, kind, wanted)
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
    const redone = new Map<number, { text: string; by: 'marker' | 'ai' }>()
    let markerSkipped: string | undefined
    let aiSkipped: string | undefined
    if (math === 'careful' && mathPages.length) {
        try {
            for (const p of await engineFor('marker')(abs, kind, mathPages))
                if (mathPages.includes(p.page)) redone.set(p.page, { text: p.text, by: 'marker' })
        } catch (e) {
            markerSkipped = why(e)
        }
        for (const n of mathPages) if (!redone.has(n)) hard.push(n)
    }
    if (hard.length) {
        try {
            for (const p of await engineFor('ai')(abs, kind, hard, target))
                if (hard.includes(p.page)) redone.set(p.page, { text: p.text, by: 'ai' })
        } catch (e) {
            aiSkipped = why(e)
        }
    }
    const by = [...redone.values()].map(r => r.by)
    return {
        pages: read.map(({ page, text }) => ({ page, text: redone.get(page)?.text ?? text })),
        engine: by.includes('ai') ? 'ai' : by.includes('marker') ? 'marker' : 'on-device',
        escalated: read.map(p => p.page).filter(n => redone.has(n)),
        math: mathPages.filter(n => !redone.has(n)),
        ...(markerSkipped ? { markerSkipped } : {}),
        ...(aiSkipped ? { aiSkipped } : {}),
    }
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
    const current = await files.readNote(root, companion).catch(() => '')
    if (readTranscript(current).length === 0) throw new AppError('ENOENT', `no transcript for ${req.file}`, 404)
    const next = addMarks(removeMarks(current, page, remove), page, add)
    if (next !== current) {
        opts.mark?.([companion])
        await files.writeNote(root, companion, next)
    }
    return { ok: true, companion, marks: marksOnPage(next, page) }
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
