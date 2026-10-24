// core/src/chatProviders/opencode/opencodeV2Client.ts
// The HTTP client for opencode 2's server (`opencode serve`, v2.x). @opencode-ai/sdk 1.x speaks the
// opencode 1 API and cannot drive it, so this is a small hand-written client over the calls a chat
// needs, every shape read off the server's own `/openapi.json` and verified live against 2.0.32.
//
// What differs from opencode 1, and why the driver branches on it:
//   - Every route lives under `/api`, behind HTTP Basic auth `opencode:<password>`. The password is
//     whatever `OPENCODE_SERVER_PASSWORD` held when the server started (opencodeServer.ts sets a
//     random one per spawn); without it the server mints one and prints it to stdout.
//   - A session belongs to a directory (`location.directory`) fixed at creation, instead of a
//     `?directory=` query on every call. Catalog reads (models, commands, integrations) take a
//     `location[directory]` deep-object query.
//   - `POST /api/session/{id}/prompt` does NOT block until the reply is done: it enqueues the message
//     in the session's inbox and returns at once. The turn's progress and its end
//     (`session.execution.succeeded|failed|interrupted`) arrive only on `GET /api/event`.
//   - A prompt carries no model and no system prompt. The model is per session
//     (`POST …/model`); extra system text is a per-session instructions entry
//     (`PUT /api/experimental/session/{id}/instructions/entries/{key}`), verified live to reach the
//     model.
//   - Stop is `POST …/interrupt`; a permission answer is `POST …/permission/{id}/reply` with
//     `{decision: once|always|reject}`; provider credentials are "integrations".
// Responses are read as untyped JSON and narrowed by the pure translators (opencodeV2Translate.ts),
// the same posture opencode 1's driver takes towards its generated types.

/** opencode refused a request: an HTTP error status, with the server's own `message` when it sent
 *  one. `tag` is the error's `_tag` (`SessionNotFoundError`, `InvalidRequestError`, …). */
export class OpencodeV2Error extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly tag?: string,
    ) {
        super(message)
    }
}

/** A `provider/model` pick as opencode 2's `Model.Ref` (`{providerID, id}`), with an optional
 *  `variant`: a reasoning-effort level the model lists (opencodeV2Translate.ts). */
export type OpencodeV2ModelRef = {
    providerID: string
    id: string
    variant?: string
}

/** One file attached to a prompt: a `data:` URI is inlined by the server (verified live). */
export type OpencodeV2File = { uri: string; name?: string }

/** An OAuth sign-in attempt off `integration.oauth.connect`. */
export type OpencodeV2Attempt = {
    attemptID: string
    url: string
    instructions: string
    mode: 'auto' | 'code'
}

export interface OpencodeV2Client {
    readonly version: 2
    readonly url: string
    createSession(
        directory: string,
        model?: OpencodeV2ModelRef | null,
    ): Promise<string>
    prompt(
        sessionId: string,
        body: { text: string; files?: OpencodeV2File[] },
    ): Promise<void>
    command(sessionId: string, name: string, text: string): Promise<void>
    switchModel(sessionId: string, model: OpencodeV2ModelRef): Promise<void>
    putInstruction(sessionId: string, key: string, value: string): Promise<void>
    removeInstruction(sessionId: string, key: string): Promise<void>
    interrupt(sessionId: string): Promise<void>
    replyPermission(
        sessionId: string,
        requestId: string,
        decision: 'once' | 'always' | 'reject',
    ): Promise<void>
    /** Every message of a session, oldest first (all pages). */
    messages(sessionId: string): Promise<unknown[]>
    deleteSession(sessionId: string): Promise<void>
    models(directory: string): Promise<unknown[]>
    commands(directory: string): Promise<unknown[]>
    integrations(directory: string): Promise<unknown[]>
    connectKey(integrationId: string, key: string): Promise<void>
    oauthConnect(
        integrationId: string,
        methodId: string,
        answer: Record<string, unknown> | null,
    ): Promise<OpencodeV2Attempt>
    oauthStatus(integrationId: string, attemptId: string): Promise<unknown>
    oauthComplete(
        integrationId: string,
        attemptId: string,
        code: string | null,
    ): Promise<void>
    /** The global event stream: one parsed `data:` payload per event, until the stream closes. */
    events(): AsyncGenerator<unknown>
}

/** The Basic `authorization` header value for a server started with `password`. Pure. */
export function opencodeV2AuthHeader(password: string): string {
    return 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
}

/** The `location[directory]=…` deep-object query catalog routes take. Pure. */
export function locationQuery(directory: string): string {
    return `location[directory]=${encodeURIComponent(directory)}`
}

/** Split an SSE buffer into the JSON payloads of its complete events plus the unconsumed tail.
 *  Comment lines (`: heartbeat`) and events whose `data:` is not JSON are dropped. Pure. */
export function parseSseEvents(buffer: string): {
    events: unknown[]
    rest: string
} {
    const events: unknown[] = []
    const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
    const rest = blocks.pop() ?? ''
    for (const block of blocks) {
        const data = block
            .split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).replace(/^ /, ''))
            .join('\n')
        if (!data) continue
        try {
            events.push(JSON.parse(data))
        } catch {
            /* a non-JSON payload carries nothing this client reads */
        }
    }
    return { events, rest }
}

/** The displayable message out of an error response body (`{_tag, message}`), else a fallback
 *  naming the status. Pure. */
export function opencodeV2ErrorFrom(
    status: number,
    body: string,
): OpencodeV2Error {
    try {
        const j = JSON.parse(body) as { message?: unknown; _tag?: unknown }
        if (typeof j.message === 'string' && j.message)
            return new OpencodeV2Error(
                j.message,
                status,
                typeof j._tag === 'string' ? j._tag : undefined,
            )
    } catch {
        /* not JSON */
    }
    return new OpencodeV2Error(`opencode answered HTTP ${status}`, status)
}

export function createOpencodeV2Client(
    url: string,
    password: string,
    fetchImpl: typeof fetch = fetch,
): OpencodeV2Client {
    const auth = opencodeV2AuthHeader(password)

    async function call(
        method: string,
        path: string,
        body?: unknown,
    ): Promise<unknown> {
        const res = await fetchImpl(url + path, {
            method,
            headers: {
                authorization: auth,
                ...(body === undefined
                    ? {}
                    : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        })
        const text = await res.text()
        if (!res.ok) throw opencodeV2ErrorFrom(res.status, text)
        if (!text) return null
        try {
            return JSON.parse(text) as unknown
        } catch {
            return null
        }
    }

    const dataOf = (j: unknown): unknown =>
        j && typeof j === 'object' ? (j as { data?: unknown }).data : undefined
    const listOf = (j: unknown): unknown[] => {
        const d = dataOf(j)
        return Array.isArray(d) ? d : []
    }
    const sid = (id: string) => encodeURIComponent(id)

    return {
        version: 2,
        url,
        async createSession(directory, model) {
            const j = await call('POST', '/api/session', {
                location: { directory },
                ...(model ? { model } : {}),
            })
            const id = (dataOf(j) as { id?: unknown } | undefined)?.id
            if (typeof id !== 'string' || !id)
                throw new OpencodeV2Error(
                    'opencode returned no session id',
                    200,
                )
            return id
        },
        async prompt(sessionId, body) {
            await call('POST', `/api/session/${sid(sessionId)}/prompt`, {
                text: body.text,
                ...(body.files?.length ? { files: body.files } : {}),
            })
        },
        async command(sessionId, name, text) {
            await call('POST', `/api/session/${sid(sessionId)}/command`, {
                name,
                text,
            })
        },
        async switchModel(sessionId, model) {
            await call('POST', `/api/session/${sid(sessionId)}/model`, {
                model,
            })
        },
        async putInstruction(sessionId, key, value) {
            await call(
                'PUT',
                `/api/experimental/session/${sid(sessionId)}/instructions/entries/${encodeURIComponent(key)}`,
                { value },
            )
        },
        async removeInstruction(sessionId, key) {
            await call(
                'DELETE',
                `/api/experimental/session/${sid(sessionId)}/instructions/entries/${encodeURIComponent(key)}`,
            )
        },
        async interrupt(sessionId) {
            await call('POST', `/api/session/${sid(sessionId)}/interrupt`)
        },
        async replyPermission(sessionId, requestId, decision) {
            await call(
                'POST',
                `/api/session/${sid(sessionId)}/permission/${encodeURIComponent(requestId)}/reply`,
                { decision },
            )
        },
        async messages(sessionId) {
            const out: unknown[] = []
            let cursor: string | null = null
            // Bounded: a session's history is finite, and a server that kept handing back a cursor
            // must not spin this forever.
            for (let page = 0; page < 200; page++) {
                const q: string = cursor
                    ? `cursor=${encodeURIComponent(cursor)}`
                    : 'order=asc'
                const j = (await call(
                    'GET',
                    `/api/session/${sid(sessionId)}/message?${q}`,
                )) as { data?: unknown; cursor?: { next?: unknown } } | null
                const data = Array.isArray(j?.data) ? j.data : []
                out.push(...data)
                const next = j?.cursor?.next
                if (!data.length || typeof next !== 'string' || !next) break
                cursor = next
            }
            return out
        },
        async deleteSession(sessionId) {
            await call('DELETE', `/api/session/${sid(sessionId)}`)
        },
        async models(directory) {
            return listOf(
                await call('GET', `/api/model?${locationQuery(directory)}`),
            )
        },
        async commands(directory) {
            return listOf(
                await call('GET', `/api/command?${locationQuery(directory)}`),
            )
        },
        async integrations(directory) {
            return listOf(
                await call(
                    'GET',
                    `/api/integration?${locationQuery(directory)}`,
                ),
            )
        },
        async connectKey(integrationId, key) {
            await call(
                'POST',
                `/api/integration/${encodeURIComponent(integrationId)}/connect/key`,
                { key },
            )
        },
        async oauthConnect(integrationId, methodId, answer) {
            const a = dataOf(
                await call(
                    'POST',
                    `/api/integration/${encodeURIComponent(integrationId)}/connect/oauth`,
                    { methodID: methodId, ...(answer ? { answer } : {}) },
                ),
            ) as Partial<OpencodeV2Attempt> | undefined
            if (
                !a ||
                typeof a.attemptID !== 'string' ||
                typeof a.url !== 'string'
            )
                throw new OpencodeV2Error(
                    'opencode returned no sign-in URL.',
                    200,
                )
            return {
                attemptID: a.attemptID,
                url: a.url,
                instructions:
                    typeof a.instructions === 'string' ? a.instructions : '',
                mode: a.mode === 'code' ? 'code' : 'auto',
            }
        },
        async oauthStatus(integrationId, attemptId) {
            return dataOf(
                await call(
                    'GET',
                    `/api/integration/${encodeURIComponent(integrationId)}/connect/oauth/${encodeURIComponent(attemptId)}`,
                ),
            )
        },
        async oauthComplete(integrationId, attemptId, code) {
            await call(
                'POST',
                `/api/integration/${encodeURIComponent(integrationId)}/connect/oauth/${encodeURIComponent(attemptId)}/complete`,
                { code },
            )
        },
        async *events() {
            const res = await fetchImpl(url + '/api/event', {
                headers: { authorization: auth, accept: 'text/event-stream' },
            })
            if (!res.ok || !res.body)
                throw opencodeV2ErrorFrom(res.status, await res.text())
            const decoder = new TextDecoder()
            let pending = ''
            for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
                pending += decoder.decode(chunk, { stream: true })
                const { events, rest } = parseSseEvents(pending)
                pending = rest
                for (const ev of events) yield ev
            }
        },
    }
}
