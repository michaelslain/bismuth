import {
    registerSession,
    endSession,
    startSubagent,
    stopSubagent,
    snapshot as relaySnapshot,
    redactSnapshot,
} from '../relay'
import { listWindows, resolveTarget, sendCommand } from '../uiControl'
import { isUiControlAllowed } from '../commands'
import { ok, error, type Handler, type RouteContext } from './context'

export default function relayRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { requestChannel } = ctx
    return {
        // Relay ingest endpoints — posted to by the relay plugin's hooks (loaded
        // per-session via `claude --plugin-dir <relay>` only inside app terminals). They
        // update the in-process agent registry; they are NOT vault mutations, so they
        // live in the read table (no cache invalidation). All are best-effort: the hooks
        // never block the user, so a 400 here is silently swallowed client-side.
        // `backend` names which agent CLI is reporting (a backend id — "claude", "codex", …). Optional:
        // the original Claude-only hooks don't send it, and the registry defaults it to "claude".
        'POST /relay/session': async req => {
            const { sessionId, terminalId, cwd, backend } =
                (await req.json()) as {
                    sessionId?: string
                    terminalId?: string
                    cwd?: string
                    backend?: string
                }
            if (!sessionId || !terminalId)
                return error('missing sessionId/terminalId', 400)
            registerSession({ sessionId, terminalId, cwd: cwd ?? '', backend })
            return ok({ ok: true })
        },

        'POST /relay/session/end': async req => {
            const { sessionId } = (await req.json()) as { sessionId?: string }
            if (!sessionId) return error('missing sessionId', 400)
            endSession(sessionId)
            return ok({ ok: true })
        },

        'POST /relay/subagent/start': async req => {
            const { parentSessionId, agentId, agentType, workflowId } =
                (await req.json()) as {
                    parentSessionId?: string
                    agentId?: string
                    agentType?: string
                    workflowId?: string
                }
            if (!parentSessionId || !agentId)
                return error('missing parentSessionId/agentId', 400)
            startSubagent({
                parentSessionId,
                agentId,
                agentType: agentType ?? 'agent',
                workflowId: workflowId || undefined,
            })
            return ok({ ok: true })
        },

        'POST /relay/subagent/stop': async req => {
            const { agentId, lastMessage } = (await req.json()) as {
                agentId?: string
                lastMessage?: string
            }
            if (!agentId) return error('missing agentId', 400)
            stopSubagent({ agentId, lastMessage })
            return ok({ ok: true })
        },

        // Read side of the registry above, for `bismuth relay list`. A subagent's RelaySubagent can
        // carry `lastMessage` (its SubagentStop last_assistant_message) — free-text output that can
        // quote vault content the same way a chat transcript snippet can — but unlike GET
        // /chat/sessions et al. there IS a non-sensitive projection: everything except lastMessage is
        // bookkeeping (ids, types, timestamps, cwd, backend), so a non-owner caller gets that
        // redacted view instead of a blanket 403. `bismuth relay list` runs from a shell and never
        // carries an owner token (see cli/src/http.ts) — a blanket gate made the route unreachable by
        // its only caller. See redactSnapshot() in relay.ts for the field-by-field classification.
        'GET /relay/snapshot': async req => {
            const snap = relaySnapshot()
            return ok(
                requestChannel(req) === 'owner' ? snap : redactSnapshot(snap),
            )
        },

        // App-control read surface (see core/src/uiControl.ts) — the ONLY channel that drives a running
        // window's tabs from outside the webview, powering the `app` CLI group and (through bismuth_cli)
        // MCP app control. Like /relay/* these live in the READ table: /ui/command relays a request to a
        // window and returns its reply; any vault mutation the window then performs runs its OWN
        // invalidation path, so there's nothing for the command route to invalidate.

        // Every connected window (id, distinct label, active tab, tab count). Empty [] when none are open.
        'GET /ui/windows': async (_, __) => {
            return ok(listWindows())
        },

        // Relay one command to a window and return its {ok, result|error}. `windowId` picks a specific
        // window; omitted, the single open window is used (0 → 404, many → 409). Two auditable gates run
        // BEFORE dispatch (mirrored client-side in uiControlClient.ts): run-command refuses any
        // blocklisted id (heavyweight verbs + opening chat), and open-tab refuses `::chat:` content —
        // opening a live recursive Agent-SDK chat is a deliberately different trust boundary.
        'POST /ui/command': async (req, __) => {
            const { windowId, action, args } = (await req.json()) as {
                windowId?: string
                action?: string
                args?: unknown
            }
            if (typeof action !== 'string' || !action)
                return error('missing action', 400)
            if (action === 'run-command') {
                const id = (args as { id?: unknown } | undefined)?.id
                if (typeof id !== 'string' || !id)
                    return error('run-command requires args.id', 400)
                if (!isUiControlAllowed(id))
                    return error(
                        `command "${id}" is not allowed via app control`,
                        403,
                    )
            }
            if (action === 'open-tab') {
                const content = (args as { content?: unknown } | undefined)
                    ?.content
                if (
                    typeof content === 'string' &&
                    content.startsWith('::chat:')
                ) {
                    return error(
                        'opening chat tabs via app control is disabled',
                        403,
                    )
                }
            }
            const target = resolveTarget(windowId)
            if (!target.ok) return error(target.error, target.status)
            return ok(await sendCommand(target.id, action, args))
        },
    }
}
