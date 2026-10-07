// core/test/support/requestRecorder.ts
// Test-only pass-through HTTP recorder: sits in front of the mock LLM (mockLlm.ts), forwards every
// request to it unchanged (responses stream straight back), and keeps each request's path and FULL
// JSON body so a test can assert on what a real agent CLI actually sent.
//
// WHY NOT aimock's own `GET /__aimock/journal` (`--metrics`): the journal replaces any request body
// over a hardcoded 64 KB (`JOURNAL_BODY_CAP_BYTES` in aimock's dist/journal.js, no flag to raise it)
// with a `{__aimock_truncated: true, originalByteSize, note}` marker. Claude Code's first turn
// crossed that line in 2.1.292 (its ~23 built-in tool schemas alone are ~58 KB), so every
// `body.model` read back from the journal came out `undefined` — while the wire request itself still
// carried the right model. A body cap that grows with the CLI's tool list is not something a test
// can sit under, so tests that read bodies record them here instead.

export type RecordedRequest = {
    method: string
    path: string
    body?: Record<string, unknown>
}

export type RequestRecorder = {
    /** Base URL to point the agent at, e.g. "http://127.0.0.1:54231". */
    url: string
    /** Every request seen so far, in arrival order. */
    requests: RecordedRequest[]
    stop(): void
}

export function startRequestRecorder(upstream: string): RequestRecorder {
    const requests: RecordedRequest[] = []
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(req) {
            const { pathname, search } = new URL(req.url)
            const text =
                req.method === 'GET' || req.method === 'HEAD'
                    ? undefined
                    : await req.text()
            let body: Record<string, unknown> | undefined
            try {
                body = text ? JSON.parse(text) : undefined
            } catch {}
            requests.push({ method: req.method, path: pathname + search, body })
            const headers = new Headers(req.headers)
            headers.delete('host')
            return fetch(upstream + pathname + search, {
                method: req.method,
                headers,
                body: text,
            })
        },
    })
    return {
        url: `http://127.0.0.1:${server.port}`,
        requests,
        stop: () => server.stop(true),
    }
}
