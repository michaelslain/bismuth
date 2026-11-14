// A stand-in `opencode` binary body for slot tests: `--version` prints 2.0.0; `serve` listens on a
// free port, prints the banner, and speaks just enough of the v2 API for opencodeServer.ts — an SSE
// `/api/event` stream, `/whoami` (the config it was spawned with) and `/end-stream` (closes every
// open event stream).
const args = process.argv.slice(2)
if (args[0] === '--version') {
    console.log('2.0.0')
    process.exit(0)
}
const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
const enc = new TextEncoder()
const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
        const path = new URL(req.url).pathname
        if (path === '/whoami')
            return Response.json({
                config: process.env.OPENCODE_CONFIG_CONTENT ?? null,
                pid: process.pid,
            })
        if (path === '/end-stream') {
            for (const c of streams) c.close()
            streams.clear()
            return new Response('ok')
        }
        if (path === '/api/event')
            return new Response(
                new ReadableStream<Uint8Array>({
                    start(c) {
                        streams.add(c)
                        c.enqueue(
                            enc.encode(
                                'data: {"id":"e0","type":"server.connected","data":{}}\n\n',
                            ),
                        )
                    },
                }),
                { headers: { 'content-type': 'text/event-stream' } },
            )
        return new Response('not found', { status: 404 })
    },
})
console.log(`server listening on ${server.url.href.replace(/\/$/, '')}`)
