// core/src/feedback.ts — feedback to Bismuth's developer. Validates a payload and forwards it to the
// hosted feedback relay (services/feedback/), which emails it on. The developer's address lives only
// in that service's environment, never here. Shared by `POST /feedback` (routes/system.ts) and the
// headless `bismuth feedback send` command, so both validate identically. Never throws: a failure is
// a `{ ok: false, error, status }` result the caller turns into its own error.
// The wire contract is feedbackContract.ts.
import { platform } from 'node:os'
import corePkg from '../package.json'
import { FEEDBACK_LIMITS, type FeedbackPayload } from './feedbackContract'

export { FEEDBACK_LIMITS, type FeedbackKind, type FeedbackPayload } from './feedbackContract'

/** The deployed relay's `POST /feedback` URL. Empty until the service is deployed; the
 *  `BISMUTH_FEEDBACK_URL` env var overrides it (local testing against `bun run services/feedback`). */
export const DEFAULT_FEEDBACK_ENDPOINT = ''

export function feedbackEndpoint(env: Record<string, string | undefined> = process.env): string {
    return env.BISMUTH_FEEDBACK_URL?.trim() || DEFAULT_FEEDBACK_ENDPOINT
}

export type FeedbackResult =
    | { ok: true; id: string }
    | { ok: false; error: string; status: number }

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v.trim() : undefined)

/** Pure: narrow untrusted input to a payload, or say what is wrong with it. Meta the caller did not
 *  supply is filled from this build (version + platform). */
export function validateFeedback(
    x: unknown,
): { ok: true; value: FeedbackPayload } | { ok: false; error: string } {
    if (!x || typeof x !== 'object') return { ok: false, error: 'feedback must be an object' }
    const o = x as Record<string, unknown>
    if (o.kind !== 'written' && o.kind !== 'interview')
        return { ok: false, error: "kind must be 'written' or 'interview'" }
    const title = str(o.title)
    if (!title) return { ok: false, error: 'title is required' }
    if (title.length > FEEDBACK_LIMITS.title)
        return { ok: false, error: `title is over ${FEEDBACK_LIMITS.title} characters` }
    const body = str(o.body)
    if (!body) return { ok: false, error: 'body is required' }
    if (body.length > FEEDBACK_LIMITS.body)
        return { ok: false, error: `body is over ${FEEDBACK_LIMITS.body} characters` }
    const contact = str(o.contact)
    if (contact && contact.length > FEEDBACK_LIMITS.contact)
        return { ok: false, error: `contact is over ${FEEDBACK_LIMITS.contact} characters` }
    const rawMeta = (o.meta && typeof o.meta === 'object' ? o.meta : {}) as Record<string, unknown>
    const meta: NonNullable<FeedbackPayload['meta']> = {
        appVersion: corePkg.version,
        platform: platform(),
    }
    for (const k of ['appVersion', 'platform', 'daemonName'] as const) {
        const v = str(rawMeta[k])
        if (v) meta[k] = v.slice(0, FEEDBACK_LIMITS.meta)
    }
    return {
        ok: true,
        value: { kind: o.kind, title, body, ...(contact ? { contact } : {}), meta },
    }
}

/** Validate, then POST to the relay. `fetchImpl` is the test seam. */
export async function submitFeedback(
    input: unknown,
    opts: { endpoint?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<FeedbackResult> {
    const v = validateFeedback(input)
    if (!v.ok) return { ok: false, error: v.error, status: 400 }
    const endpoint = opts.endpoint ?? feedbackEndpoint()
    if (!endpoint)
        return {
            ok: false,
            error: 'feedback is not set up in this build (no relay address); set BISMUTH_FEEDBACK_URL',
            status: 503,
        }
    const doFetch = opts.fetchImpl ?? fetch
    try {
        const res = await doFetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(v.value),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 15000),
        })
        const data = (await res.json().catch(() => ({}))) as { id?: unknown; error?: unknown }
        if (!res.ok)
            return {
                ok: false,
                error: typeof data.error === 'string' ? data.error : `feedback relay answered ${res.status}`,
                status: res.status === 429 || res.status === 400 ? res.status : 502,
            }
        return { ok: true, id: typeof data.id === 'string' ? data.id : '' }
    } catch (e) {
        return {
            ok: false,
            error: `could not reach the feedback relay: ${e instanceof Error ? e.message : String(e)}`,
            status: 502,
        }
    }
}
