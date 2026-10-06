import { sessionHistoryFrames } from '../chatProviders'
import { resolveBackendId } from '../agentBackends/catalog'
import {
    opencodeClient,
    refreshOpencodeFrames,
} from '../chatProviders/opencode/opencode'
import {
    getFreeAgentStatus,
    installedBackendIds,
    startFreeAgentInstall,
} from '../freeAgent'
import {
    listProviders,
    oauthAuthorize,
    oauthCallback,
    OpencodeBadRequest,
    setProviderKey,
} from '../chatProviders/opencode/opencodeProviders'
import { listChatSessions, searchChatSessions, parseChatScope } from '../chat'
import { ok, error, type Handler, type RouteContext } from './context'

export default function agentsRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { cfg, requestChannel } = ctx
    /** Shared shell of the four /opencode/* provider-connect routes. Owner-only (a connect writes a
     *  credential into the user's opencode store), then the shared opencode server's client — 409
     *  `opencode-missing` when opencode is not installed or its server will not start — then `run`.
     *  An OpencodeBadRequest (bad body, or opencode refused it) is a 400 `bad-request` whose message
     *  never carries the key. `connected` re-emits the models/auth frames to every live opencode
     *  session once `run` succeeded. */
    async function opencodeRoute(
        req: Request,
        run: (
            client: NonNullable<Awaited<ReturnType<typeof opencodeClient>>>,
            body: Record<string, unknown>,
        ) => Promise<unknown>,
        opts: { connected?: boolean; body?: boolean } = {},
    ): Promise<Response> {
        if (requestChannel(req) !== 'owner')
            return Response.json({ error: 'forbidden' }, { status: 403 })
        const client = await (cfg.opencodeClient ?? opencodeClient)().catch(
            () => null,
        )
        if (!client)
            return Response.json(
                {
                    error: 'opencode-missing',
                    message:
                        'opencode is not installed, or its server did not start. Install opencode (opencode.ai) to manage providers.',
                },
                { status: 409 },
            )
        let body: Record<string, unknown> = {}
        if (opts.body) {
            try {
                const parsed = await req.json()
                if (!parsed || typeof parsed !== 'object')
                    throw new Error('not an object')
                body = parsed as Record<string, unknown>
            } catch {
                return Response.json(
                    { error: 'bad-request', message: 'Expected a JSON body.' },
                    { status: 400 },
                )
            }
        }
        try {
            const result = await run(client, body)
            if (opts.connected) void refreshOpencodeFrames().catch(() => {})
            return Response.json(result)
        } catch (e) {
            if (e instanceof OpencodeBadRequest)
                return Response.json(
                    { error: 'bad-request', message: e.message },
                    { status: 400 },
                )
            throw e
        }
    }

    return {
        // Absolute vault path — the terminal's cwd. The frontend uses it to turn a
        // file dragged from the tree (a vault-relative path) into an absolute path to
        // insert at the shell prompt.
        'GET /terminal/info': async (_, __) => {
            return ok({ vault: cfg.vault })
        },

        // The chat history picker. Both reads operate against the vault (cfg.vault) — the SDK's session
        // store unifies the user's terminal Claude Code sessions AND in-app chat sessions for that cwd.
        //
        // `scope` (user|daemon|all) is the picker's filter, resolved HERE rather than client-side: the
        // scan pages the store until it has `limit` sessions of that scope, which a client filtering a
        // fetched page cannot do (see core/src/chat.ts). Absent/unknown → "user", the default, so an old
        // client or a hand-typed URL gets exactly the pre-filter behavior.
        //
        // Owner-token gate: blanket owner-only, not per-path filtered like /file et al. A past
        // conversation transcript has no single vault path to check visibility against (it may quote
        // the contents of any number of notes, hidden or not, across its whole history), so there's no
        // way to filter it down to "the visible subset" the way a row/search-hit list can be — and
        // there's no legitimate reason for a chat/daemon AGENT (as opposed to the owner's own History
        // picker UI) to read arbitrary past session content over HTTP at all. Refuse outright.
        'GET /chat/sessions': async (req, url) => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok({
                sessions: await listChatSessions(
                    cfg.vault,
                    undefined,
                    parseChatScope(url.searchParams.get('scope')),
                ),
            })
        },

        // Replay one past session as ChatFrames (in order) so the client can rehydrate the transcript
        // before binding/resuming it. Empty `id` → empty replay. `provider=opencode` replays from the
        // opencode store (`opencode export`) instead of the Claude Code SDK store.
        //
        // Owner-token gate: blanket owner-only — same reasoning as GET /chat/sessions above (a full
        // transcript replay is exactly the content this route exists to serve, so there's no partial
        // "safe" response to fall back to).
        'GET /chat/session-messages': async (req, url) => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const id = url.searchParams.get('id')
            const provider = resolveBackendId(
                url.searchParams.get('provider') ?? undefined,
                (ctx.appConfig.chat as Record<string, unknown> | undefined)
                    ?.provider,
                installedBackendIds,
            )
            return ok({
                frames: id
                    ? await sessionHistoryFrames(id, cfg.vault, provider)
                    : [],
            })
        },

        // Search past sessions (terminal + in-app) by CONTENT — filters the SDK's own session data
        // (title + message text) and returns matches with a snippet (the SDK has no native session
        // search). Read-only despite POST (the body carries the query), so it lives in routes, not
        // mutatingRoutes — no cache-invalidate / SSE. Empty query → no hits. `scope` mirrors
        // GET /chat/sessions so search always searches the list the picker is showing.
        //
        // Owner-token gate: blanket owner-only, same reasoning as GET /chat/sessions above — this is
        // literally the "one of the enumerated ambient content routes" from the design (a hit's
        // snippet can quote any past turn's text, hidden-note-derived or not, with no path to filter
        // against), not an oversight.
        'POST /chat/search': async (req, __) => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { query, scope } = (await req.json()) as {
                query?: string
                scope?: string
            }
            return ok({
                hits: await searchChatSessions(
                    cfg.vault,
                    query ?? '',
                    undefined,
                    parseChatScope(scope),
                ),
            })
        },

        // opencode provider manager (docs/chat/opencode-providers.md): list what is connected /
        // connectable, store an API key, drive an OAuth sign-in — all over the running `opencode
        // serve`. Owner-only; keys go straight to opencode's own store and are never logged or
        // echoed. Reads + credential writes, no vault change, so they sit in the read table.
        'GET /opencode/providers': req =>
            opencodeRoute(req, client => listProviders(client)),
        'POST /opencode/auth': req =>
            opencodeRoute(
                req,
                async (client, b) => {
                    await setProviderKey(
                        client,
                        b.id as string,
                        b.key as string,
                    )
                    return { ok: true }
                },
                { connected: true, body: true },
            ),
        'POST /opencode/oauth/authorize': req =>
            opencodeRoute(
                req,
                (client, b) =>
                    oauthAuthorize(client, b.id as string, b.method as number),
                { body: true },
            ),
        'POST /opencode/oauth/callback': req =>
            opencodeRoute(
                req,
                async (client, b) => {
                    await oauthCallback(
                        client,
                        b.id as string,
                        b.method as number,
                        typeof b.code === 'string' ? b.code : undefined,
                    )
                    return { ok: true }
                },
                { connected: true, body: true },
            ),

        // Free agent (docs/api/http-reference.md): status of the managed opencode download + a
        // one-click install. Owner-only — it downloads and installs an executable.
        'GET /agents/free': req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok(getFreeAgentStatus())
        },
        'POST /agents/free/install': req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok(startFreeAgentInstall())
        },
    }
}
