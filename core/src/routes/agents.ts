import { sessionHistoryFrames } from '../chatProviders'
import { resolveBackendId } from '../agentBackends/catalog'
import {
    opencodeClient,
    opencodeUnavailableMessage,
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
import {
    deleteChats,
    deleteChatsInScope,
    restoreChats,
    setChatVisibility,
} from '../chatLogs'
import {
    chatVisibilityFields,
    isChatVisibility,
    NO_CHAT_RULES,
    readChatVisibility,
    type ChatVisibilityRules,
} from '@bismuth/memory'
import { ok, error, type Handler, type RouteContext } from './context'

export default function agentsRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { cfg, requestChannel } = ctx
    /** The vault's chat rules for the history list; an invalid `.settings` shows every chat as
     *  inheriting `all` here, while the deny list (which fails closed) refuses agents. */
    async function chatRules(): Promise<ChatVisibilityRules> {
        const res = await readChatVisibility(cfg.vault)
        return res.ok ? res.rules : NO_CHAT_RULES
    }
    /** Shared shell of the four /opencode/* provider-connect routes. Owner-only (a connect writes a
     *  credential into the user's opencode store), then the shared opencode server's client — 409
     *  `opencode-missing` when opencode is not installed or its server will not start — then `run`
     *  (opencode 1's SDK client or the opencode 2 client; opencodeProviders.ts drives both).
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
                    message: await opencodeUnavailableMessage(),
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
            const [sessions, rules] = await Promise.all([
                listChatSessions(
                    cfg.vault,
                    undefined,
                    parseChatScope(url.searchParams.get('scope')),
                ),
                chatRules(),
            ])
            return ok({
                sessions: sessions.map(s => ({
                    ...s,
                    ...chatVisibilityFields(s.sessionId, rules),
                })),
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
            const [hits, rules] = await Promise.all([
                searchChatSessions(
                    cfg.vault,
                    query ?? '',
                    undefined,
                    parseChatScope(scope),
                ),
                chatRules(),
            ])
            return ok({
                hits: hits.map(h => ({
                    ...h,
                    ...chatVisibilityFields(h.sessionId, rules),
                })),
            })
        },

        // A past chat's AI visibility (memory/src/chatVisibility.ts): GET reads the chat default;
        // POST sets one chat's own level (`{sessionId, level}`, `level: null` clears it) or the
        // default (`{default: level}`). Owner-only: the rules decide what agents may read, so an agent
        // must never rewrite them, the same reason `folder-visibility` is refused to agents.
        'GET /chat/visibility': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            return ok({ default: (await chatRules()).default })
        },
        'POST /chat/visibility': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const body = (await req.json().catch(() => null)) as {
                sessionId?: unknown
                level?: unknown
                default?: unknown
            } | null
            if (!body) return error('expected a JSON body', 400)
            let persisted: boolean
            if (body.default !== undefined) {
                if (!isChatVisibility(body.default))
                    return error('invalid visibility', 400)
                persisted = await setChatVisibility(
                    cfg.vault,
                    { default: true },
                    body.default,
                )
            } else {
                if (typeof body.sessionId !== 'string' || !body.sessionId)
                    return error('missing sessionId', 400)
                if (body.level !== null && !isChatVisibility(body.level))
                    return error('invalid visibility', 400)
                persisted = await setChatVisibility(
                    cfg.vault,
                    { sessionId: body.sessionId },
                    body.level,
                )
            }
            if (!persisted)
                return error(
                    'settings file is invalid — fix .settings before changing chat visibility',
                    409,
                )
            return ok()
        },

        // Delete past chats: `{sessionIds}` or every chat in `{scope}`. They wait in the trash for
        // `POST /chat/restore` (the undo) until the purge (core/src/chatLogs.ts). Owner-only.
        'POST /chat/delete': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const body = (await req.json().catch(() => null)) as {
                sessionIds?: unknown
                scope?: unknown
            } | null
            if (!body) return error('expected a JSON body', 400)
            if (Array.isArray(body.sessionIds)) {
                if (!body.sessionIds.every(id => typeof id === 'string' && id))
                    return error('invalid sessionIds', 400)
                const ids = await deleteChats(
                    cfg.vault,
                    body.sessionIds as string[],
                )
                return ok({ deleted: ids.length, sessionIds: ids })
            }
            // Strict, unlike the list's lenient parse: an unknown scope must never fall back to
            // deleting the default scope.
            if (
                body.scope !== 'user' &&
                body.scope !== 'daemon' &&
                body.scope !== 'all'
            )
                return error('missing sessionIds or a valid scope', 400)
            const ids = await deleteChatsInScope(
                cfg.vault,
                parseChatScope(body.scope),
            )
            return ok({ deleted: ids.length, sessionIds: ids })
        },

        // Put deleted chats back from the trash: the undo of `POST /chat/delete`. Owner-only.
        'POST /chat/restore': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const body = (await req.json().catch(() => null)) as {
                sessionIds?: unknown
            } | null
            if (
                !Array.isArray(body?.sessionIds) ||
                !body.sessionIds.every(id => typeof id === 'string' && id)
            )
                return error('missing sessionIds', 400)
            return ok({
                restored: await restoreChats(
                    cfg.vault,
                    body.sessionIds as string[],
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
