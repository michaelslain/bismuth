import { AppError } from '../error'
import { companionPathFor } from '../fileKinds'
import {
    transcriptLines,
    markTranscript,
    transcribe,
    checkPageFile,
    readStoredTranscript,
    type MarkRequest,
    type TranscribeRequest,
} from '../transcribe'
import { isDeniedPath } from '../visibility'
import { writeTranscriptPage } from '../transcript'
import { rewritePdfPages, type PageSource } from '../pdfPages'
import { inkSidecarFor, isPdfPath } from '../fileKinds'
import { markerStatus, startMarkerSetup } from '../markerSetup'
import { error, ok, requireQueryParam, type Handler, type RouteContext } from './context'

/** Both page file and its companion must be visible to the caller; a hidden one reads as forbidden. */
async function visible(ctx: RouteContext, req: Request, file: string): Promise<boolean> {
    const denied = await ctx.denyEntriesForRequest(req)
    return !isDeniedPath(denied, file) && !isDeniedPath(denied, companionPathFor(file))
}

// Reading a transcript is a plain read: the companion holds it.
export default function transcribeRoutes(ctx: RouteContext): Record<string, Handler> {
    return {
        // Whether Marker (the local math reader) is installed, and its install job. Owner only: the
        // install runs programs on this machine.
        'GET /transcribe/setup': async req => {
            if (ctx.requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok(markerStatus())
        },
        // Install Marker in the background (markerSetup.ts) and answer the job's state at once; the
        // app polls GET. Nothing in the vault changes, so this is not a mutating handler.
        'POST /transcribe/setup': async req => {
            if (ctx.requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok(startMarkerSetup())
        },
        'GET /transcript': async (req, url) => {
            const file = requireQueryParam(url, 'file')
            checkPageFile(file)
            if (!(await visible(ctx, req, file))) return error('forbidden', 403)
            return ok(await readStoredTranscript(ctx.cfg.vault, file))
        },
        // Line boxes are recognised on demand and stored nowhere, so this POST is a read.
        'POST /transcript/lines': async req => {
            const body = (await req.json()) as { file: string; pages?: number[] }
            try {
                checkPageFile(body.file)
                if (!(await visible(ctx, req, body.file))) return error('forbidden', 403)
                return ok(await transcriptLines(ctx.cfg.vault, body))
            } catch (e) {
                if (e instanceof AppError) return error(e.message, e.statusCode)
                throw e
            }
        },
    }
}

// Transcribing writes the companion note, so it takes the mutating table (self-write mark +
// invalidate). The engines are reached from transcribe by dynamic import() only: the iPad's
// in-process core has no child_process and answers 503 VISION_UNAVAILABLE.
export function transcribeMutatingRoutes(ctx: RouteContext): Record<string, Handler> {
    return {
        'POST /transcribe': ctx.mutatingHandler(
            async req => {
                const body = (await req.json()) as TranscribeRequest
                try {
                    checkPageFile(body.file)
                    if (!(await visible(ctx, req, body.file))) return error('forbidden', 403)
                    return ok(await transcribe(ctx.cfg.vault, body, { mark: ctx.markSelfWritten }))
                } catch (e) {
                    if (e instanceof AppError) return error(e.message, e.statusCode)
                    throw e
                }
            },
            body => (typeof body?.file === 'string' ? companionPathFor(body.file) : undefined),
        ),
        'POST /transcript/mark': ctx.mutatingHandler(
            async req => {
                const body = (await req.json()) as MarkRequest
                try {
                    checkPageFile(body.file)
                    if (!(await visible(ctx, req, body.file))) return error('forbidden', 403)
                    return ok(await markTranscript(ctx.cfg.vault, body, { mark: ctx.markSelfWritten }))
                } catch (e) {
                    if (e instanceof AppError) return error(e.message, e.statusCode)
                    throw e
                }
            },
            body => (typeof body?.file === 'string' ? companionPathFor(body.file) : undefined),
        ),
        // Edit one page's transcript by hand: the text is kept as written, nothing is restamped.
        'POST /transcript/page': ctx.mutatingHandler(
            async req => {
                const body = (await req.json()) as { file: string; page: number; text: string }
                try {
                    const kind = checkPageFile(body.file)
                    if (!(await visible(ctx, req, body.file))) return error('forbidden', 403)
                    if (!Number.isInteger(body.page) || body.page < 1)
                        return error('page must be a positive integer', 400)
                    if (typeof body.text !== 'string') return error('text must be a string', 400)
                    await writeTranscriptPage(
                        ctx.cfg.vault,
                        companionPathFor(body.file),
                        body.page,
                        body.text,
                        kind,
                        { mark: ctx.markSelfWritten },
                    )
                    return ok({ ok: true })
                } catch (e) {
                    if (e instanceof AppError) return error(e.message, e.statusCode)
                    throw e
                }
            },
            body => (typeof body?.file === 'string' ? companionPathFor(body.file) : undefined),
        ),
        // Rewrite a pdf's pages (keep, move, delete, insert images / pdfs / blanks); ink, highlights
        // and transcript follow their page. Every file the order pulls pages from must be visible too.
        'POST /pdf/pages': ctx.mutatingHandler(
            async req => {
                const body = (await req.json()) as { file: string; order: PageSource[] }
                try {
                    if (typeof body.file !== 'string' || !isPdfPath(body.file)) return error('file must be a pdf', 400)
                    if (!(await visible(ctx, req, body.file))) return error('forbidden', 403)
                    if (!Array.isArray(body.order)) return error('order must be a list', 400)
                    const denied = await ctx.denyEntriesForRequest(req)
                    for (const e of body.order) {
                        const from = (e as { file?: unknown })?.file
                        if (typeof from === 'string' && isDeniedPath(denied, from)) return error('forbidden', 403)
                    }
                    return ok(await rewritePdfPages(ctx.cfg.vault, body.file, body.order, { mark: ctx.markSelfWritten }))
                } catch (e) {
                    if (e instanceof AppError) return error(e.message, e.statusCode)
                    throw e
                }
            },
            body =>
                typeof body?.file === 'string'
                    ? [body.file, inkSidecarFor(body.file), companionPathFor(body.file)]
                    : undefined,
        ),
    }
}
