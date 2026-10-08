// Tests for the feedback service: payload validation, email formatting, and the handler.

import { describe, expect, test } from 'bun:test'
import { createHandler, formatEmail, validatePayload, type EmailMessage } from './server'

const good = { kind: 'written', title: ' Hi ', body: ' Great app ' }
const env = { RESEND_API_KEY: 'k', FEEDBACK_TO: 'you@example.com' }

const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request('http://x/feedback', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers,
    })

describe('validatePayload', () => {
    test('trims and accepts a minimal payload', () => {
        expect(validatePayload(good)).toEqual({ ok: true, value: { kind: 'written', title: 'Hi', body: 'Great app' } })
    })
    test('drops unknown keys', () => {
        const r = validatePayload({ ...good, extra: 1, meta: { platform: 'mac', other: 'x' } })
        expect(r.ok && r.value).toEqual({ kind: 'written', title: 'Hi', body: 'Great app', meta: { platform: 'mac' } })
    })
    test('rejects non-objects and bad kind', () => {
        expect(validatePayload(null).ok).toBe(false)
        expect(validatePayload([]).ok).toBe(false)
        expect(validatePayload({ ...good, kind: 'x' }).ok).toBe(false)
    })
    test('title and body bounds apply after trim', () => {
        expect(validatePayload({ ...good, title: '   ' }).ok).toBe(false)
        expect(validatePayload({ ...good, title: 'a'.repeat(200) }).ok).toBe(true)
        expect(validatePayload({ ...good, title: 'a'.repeat(201) }).ok).toBe(false)
        expect(validatePayload({ ...good, body: '' }).ok).toBe(false)
        expect(validatePayload({ ...good, body: 'a'.repeat(20000) }).ok).toBe(true)
        expect(validatePayload({ ...good, body: 'a'.repeat(20001) }).ok).toBe(false)
        expect(validatePayload({ ...good, title: 5 }).ok).toBe(false)
    })
    test('contact and meta limits', () => {
        expect(validatePayload({ ...good, contact: 'a'.repeat(201) }).ok).toBe(false)
        expect(validatePayload({ ...good, contact: 3 }).ok).toBe(false)
        expect(validatePayload({ ...good, meta: { appVersion: 'a'.repeat(101) } }).ok).toBe(false)
        expect(validatePayload({ ...good, meta: 'x' }).ok).toBe(false)
        expect(validatePayload({ ...good, meta: { platform: 1 } }).ok).toBe(false)
    })
})

describe('formatEmail', () => {
    test('subject, body then meta block, omitting absent fields', () => {
        const m = formatEmail({ kind: 'interview', title: 'T', body: 'B', meta: { platform: 'mac' } })
        expect(m.subject).toBe('[bismuth feedback] interview // T')
        expect(m.text).toBe('B\n\nkind: interview\nplatform: mac\n')
        expect(m.replyTo).toBeUndefined()
    })
    test('reply-to only when contact looks like an email', () => {
        expect(formatEmail({ kind: 'written', title: 'T', body: 'B', contact: 'me@example.com' }).replyTo).toBe('me@example.com')
        const h = formatEmail({ kind: 'written', title: 'T', body: 'B', contact: '@handle' })
        expect(h.replyTo).toBeUndefined()
        expect(h.text).toContain('contact: @handle')
    })
    test('newlines in the title cannot break the subject', () => {
        expect(formatEmail({ kind: 'written', title: 'a\r\nBcc: x', body: 'B' }).subject).not.toMatch(/[\r\n]/)
    })
})

describe('handler', () => {
    const sent: EmailMessage[] = []
    const fake = async (m: EmailMessage) => (sent.push(m), { id: 'abc' })

    test('health', async () => {
        const res = await createHandler({ env })(new Request('http://x/health'))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })
    })
    test('200 sends the email', async () => {
        const h = createHandler({ env: { ...env, FEEDBACK_FROM: 'A <a@example.com>' }, sendEmail: fake })
        const res = await h(post({ ...good, contact: 'me@example.com' }))
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true, id: 'abc' })
        expect(sent[0].to).toEqual(['you@example.com'])
        expect(sent[0].from).toBe('A <a@example.com>')
        expect(sent[0].reply_to).toBe('me@example.com')
    })
    test('400 on bad JSON and invalid payload', async () => {
        const h = createHandler({ env, sendEmail: fake })
        expect((await h(post('{nope', { 'x-forwarded-for': '1.1.1.1' }))).status).toBe(400)
        expect((await h(post({ kind: 'x' }, { 'x-forwarded-for': '1.1.1.1' }))).status).toBe(400)
    })
    test('413 by content-length and by actual length', async () => {
        const h = createHandler({ env, sendEmail: fake })
        const big = 'a'.repeat(70 * 1024)
        expect((await h(post(good, { 'content-length': '70000' }))).status).toBe(413)
        expect((await h(post({ ...good, body: big }))).status).toBe(413)
    })
    test('429 on the 6th request from one IP, other IPs unaffected', async () => {
        let t = 0
        const h = createHandler({ env, sendEmail: fake, now: () => t })
        const ip = { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }
        for (let i = 0; i < 5; i++) expect((await h(post(good, ip))).status).toBe(200)
        const res = await h(post(good, ip))
        expect(res.status).toBe(429)
        expect(await res.json()).toEqual({ error: 'too many feedback submissions, try again later' })
        expect((await h(post(good, { 'x-forwarded-for': '8.8.8.8' }))).status).toBe(200)
        t += 60 * 60 * 1000 + 1
        expect((await h(post(good, ip))).status).toBe(200)
    })
    test('peer ip is used without x-forwarded-for', async () => {
        const h = createHandler({ env, sendEmail: fake })
        for (let i = 0; i < 5; i++) await h(post(good), '5.5.5.5')
        expect((await h(post(good), '5.5.5.5')).status).toBe(429)
    })
    test('503 when unconfigured', async () => {
        for (const e of [{}, { RESEND_API_KEY: 'k' }, { FEEDBACK_TO: 'you@example.com' }]) {
            const res = await createHandler({ env: e, sendEmail: fake })(post(good))
            expect(res.status).toBe(503)
            expect(await res.json()).toEqual({ error: 'feedback service is not configured' })
        }
    })
    test('502 when sending throws', async () => {
        const h = createHandler({ env, sendEmail: async () => { throw new Error('boom') } })
        expect((await h(post(good))).status).toBe(502)
    })
    test('404 elsewhere, no CORS headers', async () => {
        const h = createHandler({ env })
        expect((await h(new Request('http://x/nope'))).status).toBe(404)
        expect((await h(new Request('http://x/feedback'))).status).toBe(404)
        expect((await h(new Request('http://x/health'))).headers.get('access-control-allow-origin')).toBeNull()
    })
})
