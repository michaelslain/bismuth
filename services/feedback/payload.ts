// The wire contract for POST /feedback + its pure validator and email formatter.

export type FeedbackPayload = {
    kind: 'written' | 'interview'
    title: string
    body: string
    contact?: string
    meta?: { appVersion?: string; platform?: string; daemonName?: string }
}

export type ValidateResult = { ok: true; value: FeedbackPayload } | { ok: false; error: string }

const META_KEYS = ['appVersion', 'platform', 'daemonName'] as const

const isObject = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x)

/** Validates untrusted JSON into a FeedbackPayload; unknown keys are dropped. */
export function validatePayload(x: unknown): ValidateResult {
    if (!isObject(x)) return { ok: false, error: 'body must be a JSON object' }
    if (x.kind !== 'written' && x.kind !== 'interview') {
        return { ok: false, error: "kind must be 'written' or 'interview'" }
    }
    if (typeof x.title !== 'string') return { ok: false, error: 'title must be a string' }
    const title = x.title.trim()
    if (title.length < 1 || title.length > 200) {
        return { ok: false, error: 'title must be 1 to 200 characters' }
    }
    if (typeof x.body !== 'string') return { ok: false, error: 'body must be a string' }
    const body = x.body.trim()
    if (body.length < 1 || body.length > 20000) {
        return { ok: false, error: 'body must be 1 to 20000 characters' }
    }
    const value: FeedbackPayload = { kind: x.kind, title, body }
    if (x.contact !== undefined) {
        if (typeof x.contact !== 'string') return { ok: false, error: 'contact must be a string' }
        const contact = x.contact.trim()
        if (contact.length > 200) return { ok: false, error: 'contact must be at most 200 characters' }
        if (contact) value.contact = contact
    }
    if (x.meta !== undefined) {
        if (!isObject(x.meta)) return { ok: false, error: 'meta must be an object' }
        const meta: NonNullable<FeedbackPayload['meta']> = {}
        for (const key of META_KEYS) {
            const v = x.meta[key]
            if (v === undefined) continue
            if (typeof v !== 'string') return { ok: false, error: `meta.${key} must be a string` }
            if (v.length > 100) return { ok: false, error: `meta.${key} must be at most 100 characters` }
            if (v) meta[key] = v
        }
        value.meta = meta
    }
    return { ok: true, value }
}

const looksLikeEmail = (s: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s)

/** Subject + plain-text body (body, blank line, meta block) + reply-to when contact is an email. */
export function formatEmail(p: FeedbackPayload): { subject: string; text: string; replyTo?: string } {
    // header injection guard: subject is a single line
    const title = p.title.replace(/[\r\n]+/g, ' ')
    const lines = [`kind: ${p.kind}`]
    if (p.contact) lines.push(`contact: ${p.contact}`)
    if (p.meta?.appVersion) lines.push(`app version: ${p.meta.appVersion}`)
    if (p.meta?.platform) lines.push(`platform: ${p.meta.platform}`)
    if (p.meta?.daemonName) lines.push(`daemon name: ${p.meta.daemonName}`)
    const out: { subject: string; text: string; replyTo?: string } = {
        subject: `[bismuth feedback] ${p.kind} // ${title}`,
        text: `${p.body}\n\n${lines.join('\n')}\n`,
    }
    if (p.contact && looksLikeEmail(p.contact)) out.replyTo = p.contact
    return out
}
