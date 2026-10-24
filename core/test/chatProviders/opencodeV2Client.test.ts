// The opencode 2 HTTP client: Basic auth, request shapes, error messages, paging and the SSE
// stream, against a recording fetch.
import { describe, expect, test } from 'bun:test'
import {
    createOpencodeV2Client,
    opencodeV2AuthHeader,
    opencodeV2ErrorFrom,
    OpencodeV2Error,
    parseSseEvents,
} from '../../src/chatProviders/opencode/opencodeV2Client'

type Call = {
    method: string
    url: string
    headers: Record<string, string>
    body: unknown
}

function recorder(reply: (c: Call) => Response) {
    const calls: Call[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
        const c: Call = {
            method: init?.method ?? 'GET',
            url,
            headers: (init?.headers ?? {}) as Record<string, string>,
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
        }
        calls.push(c)
        return reply(c)
    }) as unknown as typeof fetch
    return {
        calls,
        client: createOpencodeV2Client('http://h:1', 'pw', fetchImpl),
    }
}

test('auth header is Basic opencode:<password>', () => {
    expect(opencodeV2AuthHeader('pw')).toBe(
        'Basic ' + Buffer.from('opencode:pw').toString('base64'),
    )
})

describe('requests', () => {
    test('create carries the directory and model; prompt carries text and files', async () => {
        const { calls, client } = recorder(c =>
            c.url.endsWith('/api/session')
                ? Response.json({ data: { id: 'ses_1' } })
                : Response.json({ data: { id: 'msg_1' } }),
        )
        expect(
            await client.createSession('/v', {
                providerID: 'opencode',
                id: 'big-pickle',
            }),
        ).toBe('ses_1')
        await client.prompt('ses_1', {
            text: 'hi',
            files: [{ uri: 'data:image/png;base64,AA' }],
        })
        await client.prompt('ses_1', { text: 'plain', files: [] })
        expect(calls.map(c => [c.method, c.url, c.body])).toEqual([
            [
                'POST',
                'http://h:1/api/session',
                {
                    location: { directory: '/v' },
                    model: { providerID: 'opencode', id: 'big-pickle' },
                },
            ],
            [
                'POST',
                'http://h:1/api/session/ses_1/prompt',
                { text: 'hi', files: [{ uri: 'data:image/png;base64,AA' }] },
            ],
            ['POST', 'http://h:1/api/session/ses_1/prompt', { text: 'plain' }],
        ])
        expect(calls[0].headers.authorization).toBe(opencodeV2AuthHeader('pw'))
    })

    test('catalog reads pass the location as a deep-object query', async () => {
        const { calls, client } = recorder(() =>
            Response.json({ location: {}, data: [{ id: 'm' }] }),
        )
        expect(await client.models('/a b')).toEqual([{ id: 'm' }])
        expect(calls[0].url).toBe(
            'http://h:1/api/model?location[directory]=%2Fa%20b',
        )
    })

    test('messages follow the next cursor until a page is empty', async () => {
        const pages = [
            { data: [{ id: 1 }, { id: 2 }], cursor: { next: 'c2' } },
            { data: [{ id: 3 }], cursor: { next: 'c3' } },
            { data: [], cursor: {} },
        ]
        let i = 0
        const { calls, client } = recorder(() => Response.json(pages[i++]))
        expect(await client.messages('ses_1')).toEqual([
            { id: 1 },
            { id: 2 },
            { id: 3 },
        ])
        expect(calls.map(c => c.url)).toEqual([
            'http://h:1/api/session/ses_1/message?order=asc',
            'http://h:1/api/session/ses_1/message?cursor=c2',
            'http://h:1/api/session/ses_1/message?cursor=c3',
        ])
    })

    test('an error status throws with the server message and tag', async () => {
        const { client } = recorder(() =>
            Response.json(
                {
                    _tag: 'SessionNotFoundError',
                    sessionID: 's',
                    message: 'Session not found: s',
                },
                { status: 404 },
            ),
        )
        const err = await client.interrupt('s').catch(e => e)
        expect(err).toBeInstanceOf(OpencodeV2Error)
        expect(err.message).toBe('Session not found: s')
        expect(err.tag).toBe('SessionNotFoundError')
        expect(opencodeV2ErrorFrom(500, 'oops').message).toBe(
            'opencode answered HTTP 500',
        )
    })
})

test('parseSseEvents splits complete events and keeps the tail', () => {
    const { events, rest } = parseSseEvents(
        'data: {"type":"a"}\n\n: heartbeat\n\ndata: not json\n\ndata: {"type":"b"}\r\n\r\ndata: {"ty',
    )
    expect(events).toEqual([{ type: 'a' }, { type: 'b' }])
    expect(rest).toBe('data: {"ty')
})

test('events() yields every payload across chunk boundaries', async () => {
    const chunks = [
        'data: {"type":"server.connected","data":{}}\n\nda',
        'ta: {"type":"x","data":{"sessionID":"s"}}\n\n',
    ]
    const { client } = recorder(
        () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        for (const ch of chunks)
                            c.enqueue(new TextEncoder().encode(ch))
                        c.close()
                    },
                }),
            ),
    )
    const out: unknown[] = []
    for await (const e of client.events()) out.push(e)
    expect(out).toEqual([
        { type: 'server.connected', data: {} },
        { type: 'x', data: { sessionID: 's' } },
    ])
})
