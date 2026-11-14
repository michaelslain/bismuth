// core/test/support/fakeOpencodeV2.ts
// A stand-in `opencode` 2 binary for driver tests: `--version` reports 2.x, and `serve` starts a
// scripted copy of opencode 2's `/api` server (Basic auth off OPENCODE_SERVER_PASSWORD, the global
// SSE stream, sessions, prompts, permissions, interrupts) whose event shapes are the ones captured
// from a live opencode 2.0.32. What a prompt does is chosen by a keyword in its text:
//   "PERM"  ask permission for a shell call, then run or decline it by the reply
//   "FAIL"  the provider keeps failing: session.retry.scheduled attempts 2, 3, 4, …
//   "LONG"  stream deltas until interrupted
//   "OVERFLOW"  the turn fails with LM Studio's context-overflow message unless this server carries
//               the compact profile (OPENCODE_CONFIG_CONTENT denies `opencode_*`); "OVERFLOW_ALWAYS"
//               fails on either profile
//   else    two text deltas, one tool call, one step costing $0.01, succeeded
// `run` journals to FAKE_OPENCODE_RUN_LOG (`session …` to FAKE_OPENCODE_SESSION_LOG) and prints one NDJSON turn in the
// `-s` session or a new one; FAKE_OPENCODE_NO_SERVE=1 makes
// `serve` exit 1 so the driver falls back to run mode.
// FAKE_OPENCODE_STORE=<file> keeps sessions in that file, so every server started with it shares
// one session store the way real opencode servers do; without it each server keeps its own. A
// session's messages hold each finished turn's user message and reply, and an overflowed turn's user
// message with its errored reply, as real opencode records them; `revert/stage` + `revert/commit`
// drop a message and everything after it.
// FAKE_OPENCODE_EXTRAS=1 also scripts agents (`GET /api/agent`, `POST/GET /api/session/{id}…`), the
// default model (`GET /api/model/default`) and a provider list holding `lmstudio` at
// FAKE_LMSTUDIO_URL (with one model) beside a cloud one; without it those routes answer 404. Like
// opencode 2, a server answers its first `GET /api/agent` for a directory with an empty list;
// FAKE_OPENCODE_EMPTY_AGENT_READS=<n> makes it the first n.
// Every request is journalled; `GET /__log` (no auth) returns it for assertions. The server exits
// when its parent does, so a test that forgets it leaves nothing behind.
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-v') {
    console.log('opencode v2.0.32')
    process.exit(0)
}
const OVERFLOW_MESSAGE =
    'Error: The number of tokens to keep from the initial prompt is greater than the context length. Try to load the model with a larger context length, or provide a shorter input'
if (args[0] === 'session' && process.env.FAKE_OPENCODE_SESSION_LOG) {
    // `session delete <id> --standalone` and the like: journalled to FAKE_OPENCODE_SESSION_LOG.
    const { appendFileSync } = await import('node:fs')
    appendFileSync(
        process.env.FAKE_OPENCODE_SESSION_LOG,
        JSON.stringify({ argv: args, config: null }) + '\n',
    )
    process.exit(0)
}
if (args[0] === 'run') {
    // Run mode (`opencode run --format json`): journal argv + injected config to
    // FAKE_OPENCODE_RUN_LOG, take the prompt from stdin (2.x) or the last argument, then print one
    // NDJSON turn. OVERFLOW fails unless the config denies `opencode_*` (the compact profile).
    const config = process.env.OPENCODE_CONFIG_CONTENT ?? null
    if (process.env.FAKE_OPENCODE_RUN_LOG) {
        const { appendFileSync } = await import('node:fs')
        appendFileSync(
            process.env.FAKE_OPENCODE_RUN_LOG,
            JSON.stringify({ argv: args, config }) + '\n',
        )
    }
    const prompt = (await new Response(Bun.stdin.stream()).text()).trim() || args[args.length - 1]
    const compact = (config ?? '').includes('opencode_*')
    // `-s <id>` continues that session; without it each run starts a new one.
    const sIdx = args.indexOf('-s')
    const sessionID =
        sIdx >= 0 ? args[sIdx + 1] : `ses_fakerun${Math.random().toString(36).slice(2, 8)}`
    const line = (o: unknown) => console.log(JSON.stringify(o))
    const part = (type: string, p: Record<string, unknown>) => ({
        type,
        timestamp: Date.now(),
        sessionID,
        part: { sessionID, messageID: 'msg_1', ...p },
    })
    if (prompt.includes('OVERFLOW') && !compact) {
        line({
            type: 'error',
            timestamp: Date.now(),
            sessionID,
            error: { name: 'APIError', data: { message: OVERFLOW_MESSAGE } },
        })
        process.exit(0)
    }
    line(part('step_start', { type: 'step-start' }))
    line(part('text', { id: 'prt_1', type: 'text', text: 'ok' }))
    line(part('step_finish', { type: 'step-finish', reason: 'stop', cost: 0 }))
    process.exit(0)
}
if (args[0] !== 'serve' || process.env.FAKE_OPENCODE_NO_SERVE === '1')
    process.exit(1)

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
const extras = process.env.FAKE_OPENCODE_EXTRAS === '1'
const lmstudioUrl = process.env.FAKE_LMSTUDIO_URL ?? ''
const compactProfile = (() => {
    try {
        const cfg = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}') as {
            permissions?: { action?: string }[]
        }
        return (cfg.permissions ?? []).some(p => p.action === 'opencode_*')
    } catch {
        return false
    }
})()
/** The providers the injected config declares with an `npm` package (not mere limit overrides). */
function injectedProviders(): Record<
    string,
    { models?: Record<string, { name?: string }> }
> {
    try {
        const cfg = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? '{}') as {
            provider?: Record<
                string,
                { npm?: string; models?: Record<string, { name?: string }> }
            >
        }
        return Object.fromEntries(
            Object.entries(cfg.provider ?? {}).filter(([, p]) => p.npm),
        )
    } catch {
        return {}
    }
}
type FakeSession = {
    messages: Record<string, unknown>[]
    agent?: string
    revert?: string
}
const sessions = new Map<string, FakeSession>()
const storeFile = process.env.FAKE_OPENCODE_STORE ?? ''
const { existsSync, readFileSync, writeFileSync } = await import('node:fs')
/** Re-read the shared store (a no-op without FAKE_OPENCODE_STORE). */
function loadStore() {
    if (!storeFile || !existsSync(storeFile)) return
    const all = JSON.parse(readFileSync(storeFile, 'utf8')) as Record<
        string,
        FakeSession
    >
    sessions.clear()
    for (const [id, rec] of Object.entries(all)) sessions.set(id, rec)
}
function saveStore() {
    if (storeFile)
        writeFileSync(storeFile, JSON.stringify(Object.fromEntries(sessions)))
}
/** Ids unique across every server sharing the store. */
const uid = () => `${process.pid}x${++seq}`
const agentReads = new Map<string, number>()
const emptyAgentReads = Number(process.env.FAKE_OPENCODE_EMPTY_AGENT_READS ?? 1)
const permissionWaiters = new Map<string, (d: string) => void>()
const interrupted = new Set<string>()
const tick = () => Bun.sleep(15)

async function runPrompt(sid: string, text: string) {
    const msg = `msg_${uid()}`
    send('session.execution.started', { sessionID: sid })
    if (
        text.includes('OVERFLOW') &&
        (text.includes('OVERFLOW_ALWAYS') || !compactProfile)
    ) {
        loadStore()
        sessions.get(sid)?.messages.push(
            { id: `msg_${uid()}`, type: 'user', text },
            {
                id: msg,
                type: 'assistant',
                content: [],
                finish: 'error',
                error: { type: 'provider.invalid-request', message: OVERFLOW_MESSAGE },
            },
        )
        saveStore()
        send('session.execution.failed', {
            sessionID: sid,
            error: { type: 'provider.error', message: OVERFLOW_MESSAGE },
        })
        return
    }
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
    loadStore()
    sessions.get(sid)?.messages.push(
        { id: `msg_${uid()}`, type: 'user', text },
        {
            id: msg,
            type: 'assistant',
            content: [{ type: 'text', text: 'Hello there.' }],
        },
    )
    saveStore()
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
        if (path === '/__env')
            return json({ config: process.env.OPENCODE_CONFIG_CONTENT ?? null })
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
        loadStore()

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
        if (
            extras &&
            path === '/api/agent' &&
            (agentReads.get(url.search) ?? 0) < emptyAgentReads
        ) {
            agentReads.set(url.search, (agentReads.get(url.search) ?? 0) + 1)
            return json({ data: [] })
        }
        if (extras && path === '/api/agent')
            return json({
                data: [
                    { id: 'build', name: 'build', mode: 'primary' },
                    { id: 'plan', name: 'plan', mode: 'primary' },
                    { id: 'explore', name: 'explore', mode: 'subagent' },
                    {
                        id: 'title',
                        name: 'title',
                        mode: 'primary',
                        hidden: true,
                    },
                ],
            })
        if (extras && path === '/api/model/default')
            return json({
                data: { id: 'paid', providerID: 'acme', name: 'Paid' },
            })
        if (extras && path === '/api/provider')
            return json({
                data: [
                    {
                        id: 'lmstudio',
                        name: 'LM Studio',
                        settings: { baseURL: `${lmstudioUrl}/v1` },
                    },
                    { id: 'acme', name: 'Acme' },
                ],
            })
        if (path === '/api/model')
            return json({
                data: [
                    // Providers the injected config declares (the local model, saved servers).
                    ...Object.entries(injectedProviders()).flatMap(([pid, p]) =>
                        Object.entries(p.models ?? {}).map(([mid, m]) => ({
                            id: mid,
                            providerID: pid,
                            name: m.name ?? mid,
                            cost: [{ input: 0, output: 0 }],
                            enabled: true,
                        })),
                    ),
                    ...(extras && lmstudioUrl
                        ? [
                              {
                                  id: 'qwen/qwen3.5-9b',
                                  providerID: 'lmstudio',
                                  name: 'Qwen3.5 9B (local)',
                                  cost: [{ input: 0, output: 0 }],
                                  enabled: true,
                                  limit: { context: 262144, output: 8192 },
                              },
                          ]
                        : []),
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
            const id = `ses_fake${uid()}`
            sessions.set(id, { messages: [] })
            saveStore()
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
                saveStore()
                return new Response(null, { status: 204 })
            }
            // `PATCH /api/session/{id}` (title, …): accepted; the journal holds the body.
            if (rest === '' && req.method === 'PATCH')
                return new Response(null, { status: 204 })
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
            if (extras && rest === '' && req.method === 'GET') {
                const agent = sessions.get(sid)?.agent
                return json({ data: { id: sid, ...(agent ? { agent } : {}) } })
            }
            if (extras && rest === '/agent') {
                const rec = sessions.get(sid)
                if (rec) rec.agent = String((body as { agent?: unknown }).agent)
                saveStore()
                return new Response(null, { status: 204 })
            }
            if (rest === '/revert/stage') {
                const rec = sessions.get(sid) as FakeSession
                const messageID = String(
                    (body as { messageID?: unknown }).messageID,
                )
                if (!rec.messages.some(x => x.id === messageID))
                    return json({ _tag: 'NotFound', message: messageID }, 404)
                rec.revert = messageID
                saveStore()
                return json({ data: { messageID, files: [] } })
            }
            if (rest === '/revert/commit') {
                const rec = sessions.get(sid) as FakeSession
                const at = rec.messages.findIndex(x => x.id === rec.revert)
                if (at >= 0) rec.messages = rec.messages.slice(0, at)
                delete rec.revert
                saveStore()
                return new Response(null, { status: 204 })
            }
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
