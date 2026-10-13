// core/src/pdfMarkdown.ts
// PDF → markdown: Marker (core/src/marker.ts) transcribes a vault PDF into a NEW note beside it,
// `papers/x.pdf` → `papers/x.md`, whose frontmatter `source` links back to the PDF. The PDF itself
// is never written. Three surfaces run it: `bismuth pdf md` (cli/src/commands/pdf.ts), the
// `pdf_to_markdown` MCP tool, and the PDF bar's button through `POST /convert/pdf-markdown`.
//
// A long PDF takes minutes, past Bun's 255 s request idle timeout, so the HTTP route does not hold
// the request open: it starts a job here and returns, and the app polls `GET /convert/pdf-markdown` for the
// job's state. One job per PDF at a time; a second start while one runs joins it. A running job can
// be cancelled: Marker is stopped, no note is written, and the job reads `cancelled`.
import { basename } from 'node:path'
import { fileExists, resolveInVault, writeNote } from './files'
import { isPdfPath } from './fileKinds'
import { createError } from './error'
import { markerTranscribe, sourcedNote, type OcrOptions } from './marker'

/** The note a PDF converts to: `dir/paper.pdf` → `dir/paper.md`. */
export function pdfMarkdownPath(file: string): string {
    return file.replace(/\.pdf$/i, '') + '.md'
}

export type PdfMarkdownOptions = OcrOptions & {
    /** Rewrite an existing note instead of refusing with EEXIST. */
    replace?: boolean
    /** Aborting stops Marker; the note is not written. */
    signal?: AbortSignal
}

/** Refuse what can never convert, before any engine starts. Throws an AppError. */
export function checkPdfMarkdown(vault: string, file: string, replace = false): string {
    if (!isPdfPath(file)) throw createError('BAD_REQUEST', `not a PDF: ${file}`, 400)
    if (!fileExists(vault, file)) throw createError('ENOENT', `no such file: ${file}`)
    const note = pdfMarkdownPath(file)
    if (!replace && fileExists(vault, note))
        throw createError(
            'EEXIST',
            `${note} already exists — pass --replace to rewrite it`,
            409,
        )
    return note
}

/** Convert `file` (vault-relative PDF) and write its note; returns the note's path. */
export async function convertPdfToMarkdown(
    vault: string,
    file: string,
    opts: PdfMarkdownOptions = {},
): Promise<string> {
    const note = checkPdfMarkdown(vault, file, opts.replace)
    const body = await markerTranscribe(resolveInVault(vault, file), opts, 'pdf md', opts.signal)
    if (opts.signal?.aborted) throw createError('CANCELLED', 'pdf md cancelled')
    await writeNote(vault, note, sourcedNote(body, basename(file)))
    return note
}

export type PdfMarkdownJob =
    | { state: 'idle' }
    | { state: 'running'; note: string; startedAt: number }
    | { state: 'done'; note: string }
    | { state: 'error'; message: string }
    | { state: 'cancelled'; note: string }

/** Jobs keyed by `<vault>\0<pdf path>`. A finished job's state stays until the next start, so a
 *  poll that lands after completion still reads `done`. */
const jobs = new Map<string, PdfMarkdownJob>()
/** The running job's abort and its conversion settling, by the same key. */
const runs = new Map<string, { abort: AbortController; settled: Promise<void> }>()
/** A cancelled run's conversion until its engine has exited, by the same key. A start waits for
 *  it: the stopping Marker tears down the llama-server a new one would attach to. */
const exiting = new Map<string, Promise<void>>()

const jobKey = (vault: string, file: string) => `${vault}\0${file}`

export function pdfMarkdownJob(vault: string, file: string): PdfMarkdownJob {
    return jobs.get(jobKey(vault, file)) ?? { state: 'idle' }
}

/** What a start answers: the job, or `exists` when the note is already there and `replace` was
 *  not asked for, so the caller can open it or ask to rewrite it. */
export type PdfMarkdownStart = PdfMarkdownJob | { state: 'exists'; note: string }

/** Start converting in the background; returns the job's state right after starting. Not a PDF
 *  or a missing file throws here, synchronously with the request. */
export function startPdfMarkdownJob(
    vault: string,
    file: string,
    opts: PdfMarkdownOptions = {},
    convert: typeof convertPdfToMarkdown = convertPdfToMarkdown,
): PdfMarkdownStart {
    const key = jobKey(vault, file)
    const current = jobs.get(key)
    if (current?.state === 'running') return current
    if (!opts.replace && isPdfPath(file) && fileExists(vault, pdfMarkdownPath(file)))
        return { state: 'exists', note: pdfMarkdownPath(file) }
    const note = checkPdfMarkdown(vault, file, opts.replace)
    const job: PdfMarkdownJob = { state: 'running', note, startedAt: Date.now() }
    const abort = new AbortController()
    const withSignal = { ...opts, signal: abort.signal }
    const prior = exiting.get(key)
    // Cancelled while waiting on the prior engine: never start this one.
    const run = prior
        ? prior.then(() =>
              abort.signal.aborted
                  ? Promise.reject(createError('CANCELLED', 'pdf md cancelled'))
                  : convert(vault, file, withSignal),
          )
        : convert(vault, file, withSignal)
    // A cancelled job already reads `cancelled`; how its engine exits is not news.
    const settle = (next: PdfMarkdownJob) => {
        if (jobs.get(key) !== job) return
        jobs.set(key, next)
        runs.delete(key)
    }
    const settled = run.then(
        written => settle({ state: 'done', note: written }),
        (e: unknown) =>
            settle({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    jobs.set(key, job)
    runs.set(key, { abort, settled })
    return job
}

/** Stop a running conversion: Marker is stopped and no note is written. Answers the job's state
 *  afterwards, `cancelled` for a job that was running and the unchanged state otherwise. */
export function cancelPdfMarkdownJob(vault: string, file: string): PdfMarkdownJob {
    const key = jobKey(vault, file)
    const current = jobs.get(key)
    if (current?.state !== 'running') return current ?? { state: 'idle' }
    const next: PdfMarkdownJob = { state: 'cancelled', note: current.note }
    jobs.set(key, next)
    const run = runs.get(key)
    runs.delete(key)
    if (run) {
        run.abort.abort()
        const gone: Promise<void> = run.settled.then(() => {
            if (exiting.get(key) === gone) exiting.delete(key)
        })
        exiting.set(key, gone)
    }
    return next
}
