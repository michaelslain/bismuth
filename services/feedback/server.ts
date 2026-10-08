// Bismuth feedback service: accepts a feedback payload from the app's backend and emails it
// to the developer through Resend. The destination address only ever lives in env.

import { formatEmail, validatePayload } from './payload'

export type { FeedbackPayload } from './payload'
export { formatEmail, validatePayload } from './payload'

export type FeedbackEnv = {
    RESEND_API_KEY?: string
    FEEDBACK_TO?: string
    FEEDBACK_FROM?: string
}

export type EmailMessage = { from: string; to: string[]; subject: string; text: string; reply_to?: string }

export type Deps = {
    env: FeedbackEnv
    sendEmail?: (msg: EmailMessage) => Promise<{ id: string }>
    now?: () => number
}

export const MAX_BODY_BYTES = 64 * 1024
export const RATE_LIMIT = 5
export const RATE_WINDOW_MS = 60 * 60 * 1000
const DEFAULT_FROM = 'Bismuth Feedback <onboarding@resend.dev>'

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Default sender: Resend's HTTP API via plain fetch. */
export function resendSender(apiKey: string) {
    return async (msg: EmailMessage): Promise<{ id: string }> => {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify(msg),
        })
        if (!res.ok) throw new Error(`resend responded ${res.status}`)
        const data = (await res.json()) as { id?: string }
        return { id: String(data.id ?? '') }
    }
}

/** Builds the request handler; `ip` is the socket peer, used when no x-forwarded-for is sent. */
export function createHandler(deps: Deps) {
    const now = deps.now ?? Date.now
    const hits = new Map<string, number[]>()

    // rolling window: drop stamps older than an hour, then count
    const limited = (ip: string): boolean => {
        const t = now()
        const recent = (hits.get(ip) ?? []).filter(s => t - s < RATE_WINDOW_MS)
        if (recent.length >= RATE_LIMIT) {
            hits.set(ip, recent)
            return true
        }
        recent.push(t)
        hits.set(ip, recent)
        return false
    }

    return async (req: Request, peerIp?: string): Promise<Response> => {
        const path = new URL(req.url).pathname
        if (path === '/health' && req.method === 'GET') return json(200, { ok: true })
        if (path !== '/feedback' || req.method !== 'POST') return json(404, { error: 'not found' })

        const { RESEND_API_KEY, FEEDBACK_TO, FEEDBACK_FROM } = deps.env
        if (!RESEND_API_KEY || !FEEDBACK_TO) return json(503, { error: 'feedback service is not configured' })

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || peerIp || 'unknown'
        if (limited(ip)) return json(429, { error: 'too many feedback submissions, try again later' })

        const declared = Number(req.headers.get('content-length') ?? 0)
        if (declared > MAX_BODY_BYTES) return json(413, { error: 'request body too large' })
        const raw = new Uint8Array(await req.arrayBuffer())
        if (raw.byteLength > MAX_BODY_BYTES) return json(413, { error: 'request body too large' })

        let parsed: unknown
        try {
            parsed = JSON.parse(new TextDecoder().decode(raw))
        } catch {
            return json(400, { error: 'invalid JSON' })
        }
        const v = validatePayload(parsed)
        if (!v.ok) return json(400, { error: v.error })

        const mail = formatEmail(v.value)
        const msg: EmailMessage = {
            from: FEEDBACK_FROM || DEFAULT_FROM,
            to: [FEEDBACK_TO],
            subject: mail.subject,
            text: mail.text,
        }
        if (mail.replyTo) msg.reply_to = mail.replyTo
        try {
            const sent = await (deps.sendEmail ?? resendSender(RESEND_API_KEY))(msg)
            return json(200, { ok: true, id: sent.id })
        } catch {
            return json(502, { error: 'could not send feedback email' })
        }
    }
}

if (import.meta.main) {
    const handler = createHandler({
        env: {
            RESEND_API_KEY: process.env.RESEND_API_KEY,
            FEEDBACK_TO: process.env.FEEDBACK_TO,
            FEEDBACK_FROM: process.env.FEEDBACK_FROM,
        },
    })
    const server = Bun.serve({
        port: Number(process.env.PORT) || 8787,
        fetch: (req, srv) => handler(req, srv.requestIP(req)?.address),
    })
    console.log(`feedback service listening on :${server.port}`)
}
