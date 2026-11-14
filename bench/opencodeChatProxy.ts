// A logging pass-through proxy for the live opencode chat bench: forwards every request to `target`
// and keeps each POST's parsed body (and the response status) in memory, so a test can read what
// opencode actually sent to the model server.
export type ProxiedRequest = {
    path: string
    body: unknown
    status: number
    /** The first 600 characters of the response, filled in once it has been read. */
    response: string
}

export async function startLoggingProxy(
    target: string,
): Promise<{ url: string; requests: ProxiedRequest[]; stop(): void }> {
    const requests: ProxiedRequest[] = []
    const base = target.replace(/\/+$/, '')
    const server = Bun.serve({
        port: 0,
        idleTimeout: 255,
        async fetch(req) {
            const url = new URL(req.url)
            const text = req.method === 'POST' ? await req.text() : undefined
            const res = await fetch(base + url.pathname + url.search, {
                method: req.method,
                headers: req.headers,
                body: text,
            })
            if (text !== undefined) {
                let body: unknown = text
                try {
                    body = JSON.parse(text)
                } catch {
                    /* keep the raw text */
                }
                const entry: ProxiedRequest = {
                    path: url.pathname,
                    body,
                    status: res.status,
                    response: '',
                }
                requests.push(entry)
                void res
                    .clone()
                    .text()
                    .then(t => (entry.response = t.slice(0, 600)))
                    .catch(() => {})
            }
            return new Response(res.body, {
                status: res.status,
                headers: res.headers,
            })
        },
    })
    return {
        url: `http://127.0.0.1:${server.port}`,
        requests,
        stop: () => server.stop(true),
    }
}
