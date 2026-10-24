// core/test/support/fakeOpencodeV2.ts
// A stand-in `opencode` 2 binary for driver tests: `--version` reports 2.x, and `serve` starts a
// scripted copy of opencode 2's `/api` server (Basic auth off OPENCODE_SERVER_PASSWORD, the global
// SSE stream, sessions, prompts, permissions, interrupts) whose event shapes are the ones captured
// from a live opencode 2.0.32. What a prompt does is chosen by a keyword in its text:
//   "PERM"  ask permission for a shell call, then run or decline it by the reply
//   "FAIL"  the provider keeps failing: session.retry.scheduled attempts 2, 3, 4, …
//   "LONG"  stream deltas until interrupted
//   else    two text deltas, one tool call, one step costing $0.01, succeeded
// Every request is journalled; `GET /__log` (no auth) returns it for assertions. The server exits
// when its parent does, so a test that forgets it leaves nothing behind.
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-v') {
    console.log('opencode v2.0.32')
    process.exit(0)
}
if (args[0] !== 'serve') process.exit(1)

if (process.env.FAKE_OPENCODE_PID_FILE)
    await Bun.write(process.env.FAKE_OPENCODE_PID_FILE, String(process.pid))

const password = process.env.OPENCODE_SERVER_PASSWORD ?? ''
const auth = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
const log: { method: string; path: string; body: unknown }[] = []
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const enc = new TextEncoder()
let seq = 0
const send = (type: string, data: Record<string, unknown>) => {
    const frame = enc.encode(
        `data: ${JSON.stringify({ id: `evt_${++seq}`, type, data })}\n\n`,
    )
    for (const c of streams) c.enqueue(frame)
}
const sessions = new Map<string, { messages: unknown[] }>()
const permissionWaiters = new Map<string, (d: string) => void>()
const interrupted = new Set<string>()
const tick = () => Bun.sleep(15)

async function runPrompt(sid: string, text: string) {
    const msg = `msg_${++seq}`
    send('session.execution.started', { sessionID: sid })
    if (text.includes('FAIL')) {
        for (let attempt = 2; attempt < 9; attempt++) {
            if (interrupted.has(sid)) break
            send('session.retry.scheduled', {
                sessionID: sid,
                assistantMessageID: msg,
                attempt,
                error: {
                    type: 'provider.transport',
                    message: 'ConnectionRefused',
                },
            })
            await tick()
        }
        send('session.execution.interrupted', {
            sessionID: sid,
            reason: 'user',
        })
        return
    }
    if (text.includes('LONG')) {
        while (!interrupted.has(sid)) {
            send('session.text.delta', {
                sessionID: sid,
                assistantMessageID: msg,
                ordinal: 0,
                delta: 'word ',
            })
            await tick()
        }
        send('session.execution.interrupted', {
            sessionID: sid,
            reason: 'user',
        })
        return
    }
    if (text.includes('PERM')) {
        send('session.tool.input.started', {
            sessionID: sid,
            assistantMessageID: msg,
            id: 'call_1',
            name: 'shell',
        })
        send('session.tool.called', {
            sessionID: sid,
            assistantMessageID: msg,
            id: 'call_1',
            input: { command: 'ls -1' },
        })
        const decision = await new Promise<string>(resolve => {
            permissionWaiters.set('per_1', resolve)
            send('permission.asked', {
                id: 'per_1',
                sessionID: sid,
                action: 'shell',
                resources: ['ls -1'],
                save: ['ls *'],
            })
        })
        if (decision === 'reject') {
            send('session.tool.failed', {
                sessionID: sid,
                assistantMessageID: msg,
                id: 'call_1',
                error: {
                    type: 'aborted',
                    message: 'The user declined this tool call',
                },
            })
            send('session.execution.interrupted', {
                sessionID: sid,
                reason: 'shutdown',
            })
            return
        }
        send('session.tool.success', {
            sessionID: sid,
            assistantMessageID: msg,
            id: 'call_1',
            content: [{ type: 'text', text: 'a.md\n' }],
        })
        send('session.execution.succeeded', { sessionID: sid })
        return
    }
    for (const delta of ['Hello ', 'there.']) {
        send('session.text.delta', {
            sessionID: sid,
            assistantMessageID: msg,
            ordinal: 0,
            delta,
        })
        await tick()
    }
    send('session.text.ended', {
        sessionID: sid,
        assistantMessageID: msg,
        ordinal: 0,
        text: 'Hello there.',
    })
    send('session.tool.input.started', {
        sessionID: sid,
        assistantMessageID: msg,
        id: 'call_r',
        name: 'read',
    })
    send('session.tool.called', {
        sessionID: sid,
        assistantMessageID: msg,
        id: 'call_r',
        input: { path: 'a.md' },
    })
    send('session.tool.success', {
        sessionID: sid,
        assistantMessageID: msg,
        id: 'call_r',
        content: [{ type: 'text', text: 'file body' }],
    })
    send('session.step.ended', {
        sessionID: sid,
        assistantMessageID: msg,
        finish: 'stop',
        cost: 0.01,
    })
    sessions.get(sid)?.messages.push(
        { type: 'user', text },
        {
            type: 'assistant',
            content: [{ type: 'text', text: 'Hello there.' }],
        },
    )
    send('session.execution.succeeded', { sessionID: sid })
}

const json = (data: unknown, status = 200) => Response.json(data, { status })

const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
        const url = new URL(req.url)
        const path = url.pathname
        if (path === '/__log') return json(log)
        if (req.headers.get('authorization') !== auth)
            return json(
                {
                    _tag: 'UnauthorizedError',
                    message: 'Authentication required',
                },
                401,
            )
        const body =
            req.method === 'GET' || req.method === 'DELETE'
                ? null
                : await req.json().catch(() => null)
        log.push({ method: req.method, path: path + url.search, body })

        if (path === '/api/event')
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(c) {
                        streams.add(c)
                        c.enqueue(
                            enc.encode(
                                `data: ${JSON.stringify({ id: 'evt_0', type: 'server.connected', data: {} })}\n\n`,
                            ),
                        )
                    },
                    cancel() {},
                }),
                { headers: { 'content-type': 'text/event-stream' } },
            )
        if (path === '/api/model')
            return json({
                data: [
                    {
                        id: 'free-one',
                        providerID: 'opencode',
                        name: 'Free One',
                        cost: [{ input: 0, output: 0 }],
                        enabled: true,
                    },
                    {
                        id: 'paid',
                        providerID: 'acme',
                        name: 'Paid',
                        cost: [{ input: 3, output: 15 }],
                        enabled: true,
                        variants: [
                            { id: 'low', settings: { reasoningEffort: 'low' } },
                            {
                                id: 'high',
                                settings: { reasoningEffort: 'high' },
                            },
                            {
                                id: 'fast',
                                settings: { serviceTier: 'priority' },
                            },
                        ],
                    },
                ],
            })
        if (path === '/api/command')
            return json({
                data: [{ name: 'init', description: 'guided AGENTS.md setup' }],
            })
        if (path === '/api/integration')
            return json({
                data: [
                    {
                        id: 'acme',
                        name: 'Acme',
                        methods: [{ type: 'key' }],
                        connections: [
                            {
                                type: 'credential',
                                id: 'c1',
                                label: 'k',
                                method: 'key',
                            },
                        ],
                    },
                ],
            })
        if (path === '/api/session' && req.method === 'POST') {
            const id = `ses_fake${++seq}`
            sessions.set(id, { messages: [] })
            return json({ data: { id } })
        }
        const m = path.match(/^\/api\/session\/([^/]+)(\/.*)?$/)
        if (m) {
            const sid = m[1]
            const rest = m[2] ?? ''
            if (!sessions.has(sid) && !rest.startsWith('/permission'))
                return json(
                    {
                        _tag: 'SessionNotFoundError',
                        sessionID: sid,
                        message: `Session not found: ${sid}`,
                    },
                    404,
                )
            if (rest === '' && req.method === 'DELETE') {
                sessions.delete(sid)
                return new Response(null, { status: 204 })
            }
            if (rest === '/prompt' || rest === '/command') {
                interrupted.delete(sid)
                const text =
                    rest === '/prompt'
                        ? String((body as { text?: unknown }).text ?? '')
                        : String((body as { text?: unknown }).text ?? '')
                void runPrompt(sid, text)
                return json({
                    data: { id: `msg_${++seq}`, sessionID: sid, type: 'user' },
                })
            }
            if (rest === '/model') return new Response(null, { status: 204 })
            if (rest === '/interrupt') {
                interrupted.add(sid)
                return json({ interrupted: true })
            }
            const p = rest.match(/^\/permission\/([^/]+)\/reply$/)
            if (p) {
                const decision = String(
                    (body as { decision?: unknown }).decision,
                )
                send('permission.replied', {
                    sessionID: sid,
                    requestID: p[1],
                    reply: decision,
                })
                permissionWaiters.get(p[1])?.(decision)
                return new Response(null, { status: 204 })
            }
            if (rest === '/message')
                return json({
                    data: sessions.get(sid)?.messages ?? [],
                    cursor: {},
                })
        }
        if (path.startsWith('/api/experimental/session/'))
            return new Response(null, { status: 204 })
        return json({ _tag: 'NotFound', message: `no route ${path}` }, 404)
    },
})
console.log(`server listening on http://127.0.0.1:${server.port}`)

// Exit with the parent: the driver's own teardown kills this process, and a test that never gets
// that far still leaves nothing running.
const parentPid = process.ppid
setInterval(() => {
    try {
        process.kill(parentPid, 0)
    } catch {
        process.exit(0)
    }
}, 500)

export {}
