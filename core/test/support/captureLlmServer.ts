// core/test/support/captureLlmServer.ts
// A minimal, IN-PROCESS (never a subprocess, never a proxy to anything) HTTP server for tests that
// need to inspect the actual upstream request BODY a CLI sent — not just "did a request land"
// (mockLlm.ts's /metrics covers that), but "what conversation history did it carry". Built for
// openclawMocked.test.ts's cross-chat session-isolation test: proving two sequential Bismuth chats
// against the same openclaw Gateway do NOT bleed one chat's content into the other's upstream
// request — a property `/metrics` counters alone cannot see (they count hits, not content).
//
// WHY NOT `startMockLlm()`/aimock for this: aimock (`@copilotkit/aimock`) matches fixtures and
// serves responses, but exposes no request-log/history endpoint (checked live — its bundled
// `dist/server.js`/`dist/cli.js` have no `/requests`-shaped route) — there is no way to ask it "what
// did the last request's messages array actually contain". This server exists ONLY to answer that
// one question; it is not a general-purpose replacement for mockLlm.ts anywhere else.
//
// WIRE SHAPE, verified live against a real `openclaw` 2026.3.23-2 Gateway: openclaw's "mock" provider
// (api: "openai-completions") POSTs to `/v1/chat/completions` with `"stream": true` in the body
// (confirmed via a raw capture). A FIRST version of this server answered with a single plain
// non-streaming JSON object anyway — the ACP turn still completed (`stopReason: "end_turn"`,
// `result.isError: false`), which was misread as "close enough": it is NOT. Driven end to end and
// checked for the actual `assistant-text` ChatFrame, no text ever arrived — openclaw's OpenAI client
// consumes the response as a stream regardless of what it's actually given, and a plain JSON body
// yields zero chunks rather than an error, so the turn "completes" with silently empty content. This
// server therefore emits a REAL `text/event-stream` response — one role-open chunk, one content-delta
// chunk, one `finish_reason:"stop"` chunk, then `data: [DONE]` — mirroring the exact chunk shapes
// aimock's own `buildTextChunks` (`@copilotkit/aimock/dist/helpers.js`) produces for a streaming
// reply, confirmed live to make the driver emit a real `assistant-text` frame with the expected text.
export interface CaptureLlmHandle {
    /** Base URL, no trailing slash — same convention as mockLlm.ts's MockLlmHandle.url. */
    url: string
    /** Every POST /v1/chat/completions request's parsed JSON body, in arrival order. Read directly —
     *  this server runs IN this same test process (Bun.serve), no wire round-trip needed to inspect
     *  it, unlike the real subprocesses this harness otherwise spawns. */
    captured: unknown[]
    /** Stop accepting connections. Synchronous — nothing to await (no child process here). */
    stop(): void
}

function sseLine(obj: unknown): string {
    return `data: ${JSON.stringify(obj)}\n\n`
}

/**
 * Start a local capture server on an OS-assigned free port (`port: 0`, same as every other
 * ephemeral-port user in this harness). `replyText` becomes the assistant's reply content for every
 * request — irrelevant to what this server exists to prove (the REQUEST side), but must be real,
 * streamed text so the ACP turn settles with actual `assistant-text` rather than silence.
 */
export function startCaptureLlmServer(replyText = 'Hello!'): CaptureLlmHandle {
    const captured: unknown[] = []
    const server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(req) {
            const url = new URL(req.url)
            if (
                req.method === 'POST' &&
                url.pathname === '/v1/chat/completions'
            ) {
                let body: unknown = null
                try {
                    body = await req.json()
                } catch {
                    body = null // a malformed body is still recorded (as null) — the test can see that too
                }
                captured.push(body)

                const id = 'chatcmpl-capture-' + captured.length
                const created = Math.floor(Date.now() / 1000)
                const model = 'mock'
                const stream = new ReadableStream({
                    start(controller) {
                        const enc = new TextEncoder()
                        const write = (obj: unknown) =>
                            controller.enqueue(enc.encode(sseLine(obj)))
                        write({
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model,
                            choices: [
                                {
                                    index: 0,
                                    delta: { role: 'assistant', content: '' },
                                    logprobs: null,
                                    finish_reason: null,
                                },
                            ],
                        })
                        write({
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model,
                            choices: [
                                {
                                    index: 0,
                                    delta: { content: replyText },
                                    logprobs: null,
                                    finish_reason: null,
                                },
                            ],
                        })
                        write({
                            id,
                            object: 'chat.completion.chunk',
                            created,
                            model,
                            choices: [
                                {
                                    index: 0,
                                    delta: {},
                                    logprobs: null,
                                    finish_reason: 'stop',
                                },
                            ],
                        })
                        controller.enqueue(enc.encode('data: [DONE]\n\n'))
                        controller.close()
                    },
                })
                return new Response(stream, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        Connection: 'keep-alive',
                    },
                })
            }
            return new Response('not found', { status: 404 })
        },
    })
    return {
        url: `http://127.0.0.1:${server.port}`,
        captured,
        stop: () => server.stop(true),
    }
}
