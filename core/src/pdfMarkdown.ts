// core/src/pdfMarkdown.ts
// PDF → markdown: Marker (core/src/marker.ts) transcribes a vault PDF into a NEW note beside it,
// `papers/x.pdf` → `papers/x.md`, whose frontmatter `source` links back to the PDF. The PDF itself
// is never written. Three surfaces run it: `bismuth pdf md` (cli/src/commands/pdf.ts), the
// `pdf_to_markdown` MCP tool, and the PDF bar's button through `POST /pdf/markdown`.
//
// A long PDF takes minutes, past Bun's 255 s request idle timeout, so the HTTP route does not hold
// the request open: it starts a job here and returns, and the app polls `GET /pdf/markdown` for the
// job's state. One job per PDF at a time; a second start while one runs joins it.
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
    const body = await markerTranscribe(resolveInVault(vault, file), opts, 'pdf md')
    await writeNote(vault, note, sourcedNote(body, basename(file)))
    return note
}

export type PdfMarkdownJob =
    | { state: 'idle' }
    | { state: 'running'; note: string; startedAt: number }
    | { state: 'done'; note: string }
    | { state: 'error'; message: string }

/** Jobs keyed by `<vault>\0<pdf path>`. A finished job's state stays until the next start, so a
 *  poll that lands after completion still reads `done`. */
const jobs = new Map<string, PdfMarkdownJob>()

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
    jobs.set(key, job)
    convert(vault, file, opts).then(
        written => jobs.set(key, { state: 'done', note: written }),
        (e: unknown) =>
            jobs.set(key, {
                state: 'error',
                message: e instanceof Error ? e.message : String(e),
            }),
    )
    return job
}
