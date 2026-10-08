import { formatEvent } from '../sse'
import { getBismuthStatus, ensureBismuthInstalled } from '../bismuthInstall'
import { doctorApply, doctorDryRun, doctorFixOptions } from '../doctor/routes'
import { getUpdateStatus, startUpdate, getUpdateProgress } from '../selfUpdate'
import { submitFeedback } from '../feedback'
import { ok, error, type Handler, type RouteContext } from './context'

const enc = new TextEncoder()

export default function systemRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { requestChannel, sse, cfg } = ctx
    return {
        'GET /version': async (_, __) => {
            return ok({ version: ctx.version })
        },

        'GET /events': (_, __) => {
            let subscriber: ReadableStreamDefaultController<Uint8Array>
            let heartbeat: ReturnType<typeof setInterval>
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    subscriber = controller
                    sse.subscribe(controller)
                    // Flush a byte immediately, unconditionally. Measured: a client connecting
                    // while version === 0 (nothing else to send yet — no catch-up snapshot
                    // below, no real event) received NOTHING until the next heartbeat tick, up
                    // to sseHeartbeatMs (5s default) later; this single enqueued comment is
                    // enough to make that connection resolve/flush right away instead.
                    controller.enqueue(enc.encode(`: connected\n\n`))
                    // Send initial snapshot so client knows current version without waiting for next invalidation.
                    if (ctx.version > 0) {
                        controller.enqueue(
                            enc.encode(
                                formatEvent({
                                    version: ctx.version,
                                    paths: [],
                                }),
                            ),
                        )
                    }
                    // SSE comment keeps TCP connection alive past Bun's default 10s idleTimeout.
                    const ping = enc.encode(`: keepalive\n\n`)
                    heartbeat = setInterval(() => {
                        try {
                            controller.enqueue(ping)
                        } catch {
                            // controller already closed
                        }
                    }, ctx.appConfig.server.sseHeartbeatMs)
                },
                cancel() {
                    clearInterval(heartbeat)
                    sse.unsubscribe(subscriber)
                },
            })
            return new Response(stream, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-store',
                    Connection: 'keep-alive',
                },
            })
        },

        // Machine-wide bismuth CLI + MCP install (core/src/bismuthInstall.ts). Like the daemon
        // routes above: a read-only status probe + an idempotent, version-gated ensure — system
        // actions, NOT vault mutations, so they live in the READ routes. Both never throw.
        'GET /bismuth/install': async (_, __) => {
            return ok(await getBismuthStatus())
        },

        'POST /bismuth/install': async (_, __) => {
            return ok(
                await ensureBismuthInstalled(process.env.BISMUTH_INSTALL_SRC),
            )
        },

        // The doctor (core/src/doctor/). Owner-only: findings carry paths and a fix deletes files,
        // so an agent channel must never reach it. GET is a dry run over this server's vault; POST
        // applies `{ only?: string[] }` (both risks), the same call the launch toast's `fix` makes.
        'GET /doctor': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok(await doctorDryRun(cfg.vault))
        },

        'POST /doctor/fix': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const opts = doctorFixOptions(await req.json().catch(() => ({})))
            if (!opts) return error('only must be an array of strings', 400)
            return ok(await doctorApply(cfg.vault, opts))
        },

        // Git-based self-update (core/src/selfUpdate.ts). Auto-detects when the source build is
        // behind origin/main; apply pulls + rebuilds + relaunches. System actions (not vault
        // mutations), so READ routes. Apply returns immediately; the build runs in background.
        'GET /update/status': async (_, __) => {
            return ok(await getUpdateStatus())
        },

        'POST /update/apply': async (_, __) => {
            return ok(await startUpdate())
        },

        'GET /update/progress': async (_, __) => {
            return ok(getUpdateProgress())
        },

        // Feedback to Bismuth's developer (core/src/feedback.ts): validated here, forwarded to the
        // hosted relay, emailed on from there. Owner-only — it sends text off the machine, so an
        // agent channel must never reach it; the app's send button is the owner's approval.
        'POST /feedback': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const r = await submitFeedback(await req.json().catch(() => null))
            return r.ok ? ok({ id: r.id }) : error(r.error, r.status)
        },
    }
}
