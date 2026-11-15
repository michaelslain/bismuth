import { afterAll, describe, expect, test } from 'bun:test'
import { probeLocalServer } from '../../core/src/agentBackends/contextWindowProbe'
import { OVERFLOW_MESSAGE, startModelServer, withReportedUsage, withoutOpenclawContext } from './mock'

const server = await startModelServer({
    fixtures: [{ match: { userMessage: 'hello' }, response: { content: 'Hello!' } }],
})
afterAll(() => server.stop())

const openai = (text: string) => ({
    model: 'm',
    messages: [{ role: 'user', content: text }],
})
const anthropic = (text: string) => ({
    model: 'm',
    max_tokens: 100,
    messages: [{ role: 'user', content: text }],
})
const post = (path: string, body: unknown) =>
    fetch(server.url + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    })

describe('model server', () => {
    test('records an OpenAI-shaped and an Anthropic-shaped request with estTokens', async () => {
        server.reset()
        const a = await post('/v1/chat/completions', openai('hello'))
        expect(a.status).toBe(200)
        expect(await a.text()).toContain('Hello!')
        const b = await post('/v1/messages', anthropic('hello'))
        expect(b.status).toBe(200)
        const reqs = server.requests()
        expect(reqs.map(r => r.path)).toEqual([
            '/v1/chat/completions',
            '/v1/messages',
        ])
        expect(reqs[0].estTokens).toBe(
            Math.ceil(JSON.stringify(openai('hello')).length / 4),
        )
        expect(reqs[1].body).toEqual(anthropic('hello'))
    })

    test('setWindow answers an over-window request with the overflow error in its wire shape', async () => {
        server.reset()
        server.setWindow(100)
        const big = 'x'.repeat(2000)
        const o = await post('/v1/chat/completions', openai(big))
        expect(o.status).toBe(400)
        const ob = (await o.json()) as { error: { message: string } }
        expect(ob.error.message).toBe(OVERFLOW_MESSAGE)
        const r = await post('/v1/responses', { model: 'm', input: big })
        expect(r.status).toBe(400)
        const a = await post('/v1/messages', anthropic(big))
        expect(a.status).toBe(400)
        const ab = (await a.json()) as {
            type: string
            error: { type: string; message: string }
        }
        expect(ab.type).toBe('error')
        expect(ab.error.message).toBe(OVERFLOW_MESSAGE)
        // a request that fits still goes through
        expect((await post('/v1/chat/completions', openai('hello'))).status).toBe(200)
        // the overflowing requests were still recorded
        expect(server.requests().length).toBe(4)
    })

    test('setWindow(null) restores it', async () => {
        server.reset()
        server.setWindow(100)
        server.setWindow(null)
        const res = await post('/v1/chat/completions', openai('hello' + 'y'.repeat(2000)))
        expect(res.status).not.toBe(400)
    })

    test('an upstream server is proxied and recorded', async () => {
        const up = Bun.serve({ port: 0, fetch: () => Response.json({ ok: 1 }) })
        const proxy = await startModelServer({ upstream: `http://127.0.0.1:${up.port}` })
        const res = await fetch(proxy.url + '/v1/chat/completions', {
            method: 'POST',
            body: JSON.stringify(openai('hi')),
        })
        expect(await res.json()).toEqual({ ok: 1 })
        expect(proxy.requests().length).toBe(1)
        await proxy.stop()
        up.stop(true)
    })
})

describe('model listing', () => {
    test('reports the current window in LM Studio shape, 131072 when none is set', async () => {
        server.reset()
        const open = await probeLocalServer(server.url)
        expect(open?.kind).toBe('lmstudio')
        expect(open?.models.map(m => m.id)).toEqual(['mock', 'mock-2'])
        expect(open?.models[0]!.window).toBe(131072)
        server.setWindow(8192)
        const small = await probeLocalServer(server.url)
        expect(small?.models.map(m => m.window)).toEqual([8192, 8192])
        const v1 = (await (await fetch(server.url + '/v1/models')).json()) as {
            data: { loaded_context_length: number }[]
        }
        expect(v1.data[0]!.loaded_context_length).toBe(8192)
        // listing is not a model request: nothing is recorded
        expect(server.requests().length).toBe(0)
        server.reset()
    })

    test('an upstream server keeps its own listing', async () => {
        const up = Bun.serve({ port: 0, fetch: () => Response.json({ data: [{ id: 'real' }] }) })
        const proxy = await startModelServer({ upstream: `http://127.0.0.1:${up.port}` })
        const body = (await (await fetch(proxy.url + '/v1/models')).json()) as { data: { id: string }[] }
        expect(body.data.map(m => m.id)).toEqual(['real'])
        await proxy.stop()
        up.stop(true)
    })
})

describe('withoutOpenclawContext', () => {
    const ctx = { role: 'user', content: 'OpenClaw runtime context: x. End OpenClaw runtime context.' }
    const ask = { role: 'user', content: 'say ok' }
    test('drops a trailing runtime-context user message so the prompt is last', () => {
        expect(withoutOpenclawContext({ model: 'm', messages: [ask, ctx] })).toEqual({
            model: 'm',
            messages: [ask],
        })
    })
    test('leaves an ordinary body, and a context block that is not last, alone', () => {
        const plain = { messages: [ask] }
        expect(withoutOpenclawContext(plain)).toBe(plain)
        const mid = { messages: [ctx, ask] }
        expect(withoutOpenclawContext(mid)).toBe(mid)
    })
})

const responsesServer = await startModelServer({
    fixtures: [{ match: { userMessage: 'usage-probe' }, response: { content: 'ok' } }],
})
afterAll(() => responsesServer.stop())

describe('Responses API usage', () => {
    const call = (stream: boolean) =>
        fetch(responsesServer.url + '/v1/responses', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'm', stream, input: 'usage-probe ' + 'x'.repeat(4000) }),
        })

    test('withReportedUsage fills a zero input_tokens and leaves a real one', () => {
        const zero = { type: 'response.completed', response: { usage: { input_tokens: 0, output_tokens: 3, total_tokens: 0 } } }
        expect(withReportedUsage(zero, 900)).toEqual({
            type: 'response.completed',
            response: { usage: { input_tokens: 900, output_tokens: 3, total_tokens: 903 } },
        })
        const real = { usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } }
        expect(withReportedUsage(real, 900)).toBe(real)
    })
    test('a streamed Responses reply reports the request size, not zero', async () => {
        responsesServer.reset()
        const res = await call(true)
        const text = await res.text()
        const est = responsesServer.requests()[0].estTokens
        expect(est).toBeGreaterThan(1000)
        const done = text
            .split('\n')
            .filter(l => l.startsWith('data:') && l.includes('"response.completed"'))
            .map(l => JSON.parse(l.slice(5)))[0]
        expect(done.response.usage.input_tokens).toBe(est)
        expect(done.response.usage.total_tokens).toBeGreaterThanOrEqual(est)
    })
    test('a non-streamed Responses reply reports it too', async () => {
        responsesServer.reset()
        const body = (await (await call(false)).json()) as { usage: { input_tokens: number } }
        expect(body.usage.input_tokens).toBe(responsesServer.requests()[0].estTokens)
    })
    test('Chat Completions is left alone', async () => {
        const r = await fetch(responsesServer.url + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'usage-probe' }] }),
        })
        expect(r.status).toBe(200)
    })
})
