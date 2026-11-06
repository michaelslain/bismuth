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
    }
}
