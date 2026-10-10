import { recallServiceFor, type RecallRequest } from '../memoryRecall'
import { ok, error, type Handler, type RouteContext } from './context'

const MODES = new Set(['prompt', 'tool', 'session-start', 'subagent'])

const isStr = (v: unknown): v is string => typeof v === 'string'

/** A well-formed RecallRequest or null. Strict on the fields recall reads, so a malformed hook
 *  payload is a 400 rather than a silent empty recall. */
function parseRecallRequest(body: unknown): RecallRequest | null {
    if (!body || typeof body !== 'object') return null
    const b = body as Record<string, unknown>
    if (!isStr(b.mode) || !MODES.has(b.mode)) return null
    if (!isStr(b.sessionId) || !b.sessionId) return null
    for (const k of ['agentId', 'prompt', 'transcriptPath', 'source'])
        if (b[k] !== undefined && !isStr(b[k])) return null
    let toolCalls: RecallRequest['toolCalls']
    if (b.toolCalls !== undefined) {
        if (!Array.isArray(b.toolCalls)) return null
        for (const c of b.toolCalls)
            if (!c || typeof c !== 'object' || !isStr((c as any).tool_name))
                return null
        toolCalls = b.toolCalls as RecallRequest['toolCalls']
    }
    return {
        mode: b.mode as RecallRequest['mode'],
        sessionId: b.sessionId,
        ...(b.agentId !== undefined ? { agentId: b.agentId as string } : {}),
        ...(b.prompt !== undefined ? { prompt: b.prompt as string } : {}),
        ...(b.transcriptPath !== undefined
            ? { transcriptPath: b.transcriptPath as string }
            : {}),
        ...(toolCalls ? { toolCalls } : {}),
        ...(b.source !== undefined ? { source: b.source as string } : {}),
    }
}

export default function memoryRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    return {
        // Read table, no invalidate, no owner token. Prompt and tool recall return daemon-visible
        // notes only (isMemoryNoteVisibleToDaemon). Session-start composes the brain block for the
        // request's channel: a caller presenting `X-Bismuth-Channel: chat` or the owner token gets
        // the chat view, anything else the stricter daemon view. The service reads `.settings`
        // live, so a daemon.recall toggle applies on the next call.
        'POST /memory/recall': async req => {
            // Tokenless + CORS `*` + text/plain-tolerant body means any web page could read memory
            // excerpts. Relay hooks use bun's fetch (no Origin) and the chat calls in-process, so a
            // browser-originated request is refused outright.
            if (req.headers.get('origin') !== null)
                return error('cross-origin recall refused', 403)
            let body: unknown
            try {
                body = await req.json()
            } catch {
                return error('invalid JSON body', 400)
            }
            const parsed = parseRecallRequest(body)
            if (!parsed) return error('invalid recall request', 400)
            // req.signal aborts when the relay hook gives up and drops its fetch.
            return ok(
                await recallServiceFor(ctx.cfg.vault).recall({
                    ...parsed,
                    channel:
                        ctx.requestChannel(req) === 'daemon' ? 'daemon' : 'chat',
                    signal: req.signal,
                }),
            )
        },
    }
}
