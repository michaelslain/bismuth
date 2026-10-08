import { test, expect } from 'bun:test'
import {
    feedbackEndpoint,
    submitFeedback,
    validateFeedback,
    FEEDBACK_LIMITS,
} from '../src/feedback'

const good = { kind: 'written', title: ' Graph is slow ', body: ' panning stutters ' }

test('validate trims and fills build meta', () => {
    const r = validateFeedback(good)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.title).toBe('Graph is slow')
    expect(r.value.body).toBe('panning stutters')
    expect(r.value.meta?.platform).toBeTruthy()
    expect(r.value.meta?.appVersion).toBeTruthy()
    expect('contact' in r.value).toBe(false)
})

test('validate keeps caller meta and drops unknown keys', () => {
    const r = validateFeedback({
        ...good,
        kind: 'interview',
        contact: 'me@example.com',
        meta: { daemonName: 'ash', extra: 'x' },
        secret: 'nope',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.meta?.daemonName).toBe('ash')
    expect(r.value.contact).toBe('me@example.com')
    expect(JSON.stringify(r.value)).not.toContain('nope')
})

test('validate rejects bad input', () => {
    expect(validateFeedback(null).ok).toBe(false)
    expect(validateFeedback({ ...good, kind: 'rant' }).ok).toBe(false)
    expect(validateFeedback({ ...good, title: '   ' }).ok).toBe(false)
    expect(validateFeedback({ ...good, body: '' }).ok).toBe(false)
    expect(
        validateFeedback({ ...good, body: 'x'.repeat(FEEDBACK_LIMITS.body + 1) }).ok,
    ).toBe(false)
    expect(
        validateFeedback({ ...good, contact: 'x'.repeat(FEEDBACK_LIMITS.contact + 1) }).ok,
    ).toBe(false)
})

test('endpoint comes from BISMUTH_FEEDBACK_URL when set', () => {
    expect(feedbackEndpoint({ BISMUTH_FEEDBACK_URL: ' http://x/feedback ' })).toBe(
        'http://x/feedback',
    )
})

test('submit refuses invalid input without calling out', async () => {
    let called = false
    const r = await submitFeedback(
        { kind: 'written' },
        { endpoint: 'http://x', fetchImpl: (async () => ((called = true), new Response())) as any },
    )
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(called).toBe(false)
})

test('submit with no endpoint is 503', async () => {
    const r = await submitFeedback(good, { endpoint: '' })
    expect(r).toMatchObject({ ok: false, status: 503 })
})

test('submit posts the validated payload and returns the id', async () => {
    let sent: any
    const fetchImpl = (async (url: string, init: RequestInit) => {
        sent = { url, body: JSON.parse(String(init.body)) }
        return Response.json({ ok: true, id: 'abc' })
    }) as any
    const r = await submitFeedback(good, { endpoint: 'http://relay/feedback', fetchImpl })
    expect(r).toEqual({ ok: true, id: 'abc' })
    expect(sent.url).toBe('http://relay/feedback')
    expect(sent.body.title).toBe('Graph is slow')
})

test('submit maps relay failures', async () => {
    const answer = (status: number, body: object) =>
        (async () => Response.json(body, { status })) as any
    expect(
        await submitFeedback(good, { endpoint: 'http://r', fetchImpl: answer(429, { error: 'slow down' }) }),
    ).toEqual({ ok: false, error: 'slow down', status: 429 })
    expect(
        await submitFeedback(good, { endpoint: 'http://r', fetchImpl: answer(500, {}) }),
    ).toMatchObject({ ok: false, status: 502 })
    const boom = (async () => {
        throw new Error('ECONNREFUSED')
    }) as any
    const r = await submitFeedback(good, { endpoint: 'http://r', fetchImpl: boom })
    expect(r).toMatchObject({ ok: false, status: 502 })
    if (!r.ok) expect(r.error).toContain('ECONNREFUSED')
})
