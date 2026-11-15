// bench/backendBench/mock.ts
// The model server a target talks to: one recording proxy in front of aimock (mock mode, answering
// from scenario fixtures) or in front of a local server (LM Studio, ollama). It records every POST
// so a scenario can read what the backend actually sent the model, and `setWindow` makes it behave
// like a server loaded with a small context window, answering an over-window request with LM
// Studio's own overflow error in the request's wire shape. In fixtures mode the server also answers
// LM Studio's model listing (`GET /api/v0/models`, and `/v1/models` in the same shape) with the
// window `setWindow` chose, so a backend that probes a local server for its window sees it.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockLlm, type MockLlmHandle } from '../../core/test/support/mockLlm'
import type { ModelRequest } from './types'

export type ModelServer = {
    url: string
    requests(): ModelRequest[]
    /** Forget the recorded requests and restore the window to unlimited. */
    reset(): void
    setWindow(tokens: number | null): void
    stop(): Promise<void>
}

/** LM Studio's wording when a prompt does not fit the loaded context. */
export const OVERFLOW_MESSAGE =
    'The number of tokens to keep from the initial prompt is greater than the context length'

/** The 400 body for `path`: Anthropic's envelope on `/v1/messages`, OpenAI's everywhere else. */
function overflowBody(path: string): unknown {
    if (path.endsWith('/messages'))
        return {
            type: 'error',
            error: { type: 'invalid_request_error', message: OVERFLOW_MESSAGE },
        }
    return {
        error: {
            message: OVERFLOW_MESSAGE,
            type: 'invalid_request_error',
            param: null,
            code: null,
        },
    }
}

/** openclaw ends every turn with its own runtime-context user message ("OpenClaw runtime context:
 *  ... End OpenClaw runtime context."). aimock's `userMessage` matcher reads the LAST user message,
 *  so no fixture keyed on the real prompt would match. The copy forwarded to aimock drops that one
 *  trailing block, so the match runs against the prompt before it; the recorded body keeps it, and
 *  no fixture match is loosened. */
const OPENCLAW_CONTEXT = /OpenClaw runtime context/

const textOf = (m: unknown): string => JSON.stringify((m as { content?: unknown } | null)?.content ?? '')

/** `body` without the trailing openclaw runtime-context user message, or `body` itself when the
 *  last message is not one. */
export function withoutOpenclawContext(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body
    const b = body as Record<string, unknown>
    for (const k of ['messages', 'input']) {
        const list = b[k]
        if (!Array.isArray(list) || list.length < 2) continue
        const last = list[list.length - 1]
        if ((last as { role?: unknown } | null)?.role !== 'user') continue
        if (!OPENCLAW_CONTEXT.test(textOf(last))) continue
        return { ...b, [k]: list.slice(0, -1) }
    }
    return body
}

/** The Responses API's usage block with `input_tokens` filled in. aimock reports zero usage there
 *  unless a fixture carries one, and codex decides to compact from server-reported usage, so the
 *  proxy reports the request's own size (the same estimate the Chat Completions path gets). */
export function withReportedUsage(obj: unknown, inputTokens: number): unknown {
    if (!obj || typeof obj !== 'object') return obj
    const o = obj as Record<string, unknown>
    let changed = false
    const fix = (holder: Record<string, unknown>) => {
        const u = holder.usage as Record<string, unknown> | null | undefined
        if (!u || typeof u !== 'object' || u.input_tokens !== 0) return holder
        changed = true
        const out = typeof u.output_tokens === 'number' ? u.output_tokens : 0
        return {
            ...holder,
            usage: { ...u, input_tokens: inputTokens, total_tokens: inputTokens + out },
        }
    }
    const top = fix(o)
    const resp = top.response
    const inner =
        resp && typeof resp === 'object' ? fix(resp as Record<string, unknown>) : resp
    if (!changed) return obj
    return inner === resp ? top : { ...top, response: inner }
}

/** One SSE line, or a whole JSON body, with the usage filled in; anything else comes back as is. */
export function reportUsageInLine(line: string, inputTokens: number): string {
    const m = /^(data: ?)(\{.*\})$/.exec(line)
    const json = m ? m[2] : line.trimStart().startsWith('{') ? line : null
    if (json === null || !json.includes('"usage"')) return line
    try {
        const parsed = JSON.parse(json)
        const next = withReportedUsage(parsed, inputTokens)
        if (next === parsed) return line
        return (m ? m[1] : '') + JSON.stringify(next)
    } catch {
        return line
    }
}

/** `res`'s body with usage reported, streamed line by line so a fixture's latency still spaces
 *  the chunks out. */
function withUsageStream(res: Response, inputTokens: number): Response {
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    if (!res.body) return new Response(res.body, { status: res.status, headers })
    const dec = new TextDecoder()
    const enc = new TextEncoder()
    let rest = ''
    const out = res.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, ctl) {
                rest += dec.decode(chunk, { stream: true })
                const lines = rest.split('\n')
                rest = lines.pop() as string
                if (lines.length)
                    ctl.enqueue(
                        enc.encode(
                            lines.map(l => reportUsageInLine(l, inputTokens)).join('\n') + '\n',
                        ),
                    )
            },
            flush(ctl) {
                rest += dec.decode()
                if (rest) ctl.enqueue(enc.encode(reportUsageInLine(rest, inputTokens)))
            },
        }),
    )
    return new Response(out, { status: res.status, headers })
}

/** What the listing reports as the context length when no window is set. */
export const DEFAULT_WINDOW = 131072

/** The model ids the fixtures-mode server lists: `opencode@mock` switches between the two. */
const MOCK_MODEL_IDS = ['mock', 'mock-2']

/** LM Studio's `/api/v0/models` body, every model loaded at `window`. */
export function modelListing(window: number | null): unknown {
    return {
        object: 'list',
        data: MOCK_MODEL_IDS.map(id => ({
            id,
            object: 'model',
            type: 'llm',
            state: 'loaded',
            loaded_context_length: window ?? DEFAULT_WINDOW,
            max_context_length: DEFAULT_WINDOW,
        })),
    }
}

export async function startModelServer(
    opts: { fixtures: unknown[] } | { upstream: string },
): Promise<ModelServer> {
    let mock: MockLlmHandle | null = null
    let fixtureDir: string | null = null
    let upstream: string
    if ('fixtures' in opts) {
        fixtureDir = mkdtempSync(join(tmpdir(), 'bismuth-bench-fixtures-'))
        writeFileSync(
            join(fixtureDir, 'fixtures.json'),
            JSON.stringify({ fixtures: opts.fixtures }),
        )
        try {
            mock = await startMockLlm(fixtureDir)
        } catch (err) {
            rmSync(fixtureDir, { recursive: true, force: true })
            throw err
        }
        upstream = mock.url
    } else upstream = opts.upstream
    upstream = upstream.replace(/\/+$/, '')

    const seen: ModelRequest[] = []
    let window: number | null = null

    const server = Bun.serve({
        port: 0,
        idleTimeout: 255,
        async fetch(req) {
            const url = new URL(req.url)
            if (
                mock &&
                req.method === 'GET' &&
                (url.pathname === '/api/v0/models' ||
                    url.pathname === '/v1/models')
            )
                return Response.json(modelListing(window))
            const text = req.method === 'POST' ? await req.text() : undefined
            if (text !== undefined) {
                let body: unknown = text
                try {
                    body = JSON.parse(text)
                } catch {
                    /* keep the raw text */
                }
                const estTokens = Math.ceil(text.length / 4)
                seen.push({
                    path: url.pathname,
                    body,
                    estTokens,
                    at: Date.now(),
                })
                if (window !== null && estTokens > window)
                    return Response.json(overflowBody(url.pathname), {
                        status: 400,
                    })
            }
            let forward = text
            if (mock && forward !== undefined) {
                try {
                    const parsed = JSON.parse(forward)
                    const trimmed = withoutOpenclawContext(parsed)
                    if (trimmed !== parsed) forward = JSON.stringify(trimmed)
                } catch {
                    /* not JSON: forward as is */
                }
            }
            const headers = new Headers(req.headers)
            headers.delete('host')
            headers.delete('content-length')
            try {
                const res = await fetch(upstream + url.pathname + url.search, {
                    method: req.method,
                    headers,
                    body: forward,
                })
                // Fixtures mode only: a local server reports its own usage.
                if (mock && url.pathname.endsWith('/responses') && text !== undefined)
                    return withUsageStream(res, Math.ceil(text.length / 4))
                return new Response(res.body, {
                    status: res.status,
                    headers: res.headers,
                })
            } catch (err) {
                return Response.json(
                    {
                        error: {
                            message: `bench proxy could not reach ${upstream}: ${err instanceof Error ? err.message : String(err)}`,
                        },
                    },
                    { status: 502 },
                )
            }
        },
    })

    return {
        url: `http://127.0.0.1:${server.port}`,
        requests: () => seen.slice(),
        reset() {
            seen.length = 0
            window = null
        },
        setWindow(tokens) {
            window = tokens
        },
        async stop() {
            server.stop(true)
            if (mock) await mock.stop()
            if (fixtureDir)
                rmSync(fixtureDir, { recursive: true, force: true })
        },
    }
}
