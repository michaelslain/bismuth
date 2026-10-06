import { parseBaseFile } from '../bases/parse'
import { type AppConfig } from '../settings'
import { fileBasename } from '../pathUtils'
import {
    status as gcalStatus,
    setCredentials as gcalSetCredentials,
    startAuth as gcalStartAuth,
    completeAuth as gcalCompleteAuth,
    disconnect as gcalDisconnect,
    sync as gcalSync,
} from '../gcal'
import type { ConflictPolicy } from '../gcal/sync'
import { resolveGcalConfig, type LegacyGcalConfig } from '../gcal/config'
import { gcalAutoSyncEnabled } from '../gcal/manifest'
import { ok, error, type Handler, type RouteContext } from './context'

// Google Calendar state is MACHINE-WIDE and belongs to the real app: ~/.bismuth/gcal holds one refresh
// token, one set of client credentials and one sync manifest for every core on this machine, and a sync
// writes to the user's REAL calendar (Phase C of sync.ts deletes remote events missing from the vault it
// is pointed at). So every route that calls Google or writes that state — sync, disconnect, credentials,
// and both halves of the OAuth flow — is gated exactly like the auto-sync ticker: only the installed app,
// or a human who opted in with BISMUTH_GCAL_AUTOSYNC=1 (gcalAutoSyncEnabled, core/src/gcal/manifest.ts).
// A dev/test/agent core — possibly on a vault COPY — otherwise synced the copy against the real calendar,
// revoked the real token on disconnect, or overwrote the real connection. "A person clicking a button" is
// no human in the loop: `bismuth gcal sync` / `connect` / `disconnect` reach these routes from any agent,
// through the CLI or MCP's bismuth_cli. A refusal happens before the route does anything — no Google
// call, no state or manifest write, no base read, no self-write mark, no cache invalidation. GET
// /gcal/status stays open: it only reads. `html` answers the browser-navigation callback with the same
// small page it renders for every other outcome instead of JSON.
const onlyWhenGcalEnabled =
    (
        refusal: { action: string; message: string; html?: boolean },
        handler: Handler,
    ): Handler =>
    (req, url, handlerCfg) => {
        if (gcalAutoSyncEnabled()) return handler(req, url, handlerCfg)
        console.log(
            `[gcal] ${refusal.action} off outside the installed app (set BISMUTH_GCAL_AUTOSYNC=1 to enable)`,
        )
        const message = `${refusal.message} Set BISMUTH_GCAL_AUTOSYNC=1 on the core to enable it deliberately.`
        return refusal.html
            ? gcalCallbackHtml(message, false, 403)
            : Response.json({ error: message }, { status: 403 })
    }
const GCAL_NOT_THE_APP =
    'it is not the installed Bismuth app, and the Google Calendar connection on this machine belongs to the real app'

/** A small self-contained HTML page shown in the user's browser after the Google
 *  OAuth loopback redirect (success or failure). `message` is escaped — it can carry
 *  the account email or an error string from Google. */
function gcalCallbackHtml(
    message: string,
    success: boolean,
    status = 200,
): Response {
    const esc = message.replace(/[&<>]/g, c =>
        c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
    )
    const tint = success ? '#3fb950' : '#f85149'
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bismuth // Google Calendar</title>
<style>html,body{height:100%;margin:0}body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center}
.card{max-width:440px;padding:40px;text-align:center;line-height:1.55}.glyph{font-size:44px;color:${tint};margin-bottom:8px}.msg{font-size:15px;color:#c9d1d9}</style></head>
<body><div class="card"><div class="glyph">${success ? '✓' : '✕'}</div><div class="msg">${esc}</div></div></body></html>`
    return new Response(html, {
        status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
}

/** The CONNECTION-LEVEL gcal sync args, shared by every synced calendar: conflict policy,
 *  naive-event timezone, and the active theme (for the `accent` category color). The
 *  per-calendar linkage (which base ↔ which Google calendar, and whether sync is on) is NOT
 *  here — it lives on each calendar base's frontmatter (see gcal/config.ts). */
export function gcalConnectionArgs(appConfig: AppConfig) {
    const gc = appConfig.googleCalendar
    return {
        policy: (gc?.conflictPolicy ?? 'lastWriteWins') as ConflictPolicy,
        timeZone: gc?.timeZone ?? '',
        theme: (appConfig.appearance as { theme?: string } | undefined)?.theme,
    }
}

/** The LEGACY global googleCalendar.{enabled,calendarId,basePath} — the migration source a
 *  per-base resolve falls back to for the one base the old single mapping named. */
export function legacyGcalConfig(appConfig: AppConfig): LegacyGcalConfig {
    const gc = appConfig.googleCalendar
    return {
        enabled: gc?.enabled,
        calendarId: gc?.calendarId,
        basePath: gc?.basePath,
    }
}

export default function gcalRoutes(ctx: RouteContext): Record<string, Handler> {
    return {
        // Google Calendar two-way sync — Phase 0: OAuth plumbing. The flow (Authorization
        // Code + PKCE, loopback redirect) and all secrets live OUTSIDE the vault
        // (~/.bismuth/gcal); these are SYSTEM actions, not vault mutations, so — like the
        // /daemon/* routes — they live in the READ table (no cache-invalidate). The single
        // requested scope is calendar.events (events read+write only; no Gmail/Drive/contacts).
        'GET /gcal/status': async (_, __) => {
            return ok(gcalStatus())
        },

        // Store the OAuth client credentials (id + secret) outside the vault. Sent once
        // from the connect modal; the secret never enters settings.yaml/git.
        'POST /gcal/credentials': onlyWhenGcalEnabled(
            {
                action: 'connect',
                message: `Connecting Google Calendar is off on this core: ${GCAL_NOT_THE_APP}, so storing client credentials here would overwrite its credentials.`,
            },
            async req => {
                const { clientId, clientSecret } = (await req.json()) as {
                    clientId?: string
                    clientSecret?: string
                }
                if (!clientId || !clientSecret)
                    return error('missing clientId/clientSecret', 400)
                gcalSetCredentials(clientId, clientSecret)
                return ok({ ok: true })
            },
        ),

        // Begin auth: returns the Google consent URL for the frontend to open in the system
        // browser. The loopback redirect targets THIS backend's port (Google desktop clients
        // accept any 127.0.0.1 port), so the callback lands right back here.
        'POST /gcal/auth/start': onlyWhenGcalEnabled(
            {
                action: 'connect',
                message: `Connecting Google Calendar is off on this core: ${GCAL_NOT_THE_APP}, so signing in here would replace its token.`,
            },
            async (_, __) => {
                const redirectUri = `http://127.0.0.1:${ctx.server.port}/gcal/callback`
                try {
                    return ok({ url: await gcalStartAuth(redirectUri) })
                } catch (e) {
                    return error((e as Error).message, 400)
                }
            },
        ),

        // The loopback redirect target Google sends the user's browser to (top-level
        // navigation, not fetch → no CORS). Exchanges the code and renders a small HTML page.
        'GET /gcal/callback': onlyWhenGcalEnabled(
            {
                action: 'connect',
                message: `Connecting Google Calendar is off on this core: ${GCAL_NOT_THE_APP}, so finishing sign-in here would replace its token. Nothing was stored.`,
                html: true,
            },
            async (_, url) => {
                const errParam = url.searchParams.get('error')
                if (errParam)
                    return gcalCallbackHtml(
                        `Authorization was cancelled or failed (${errParam}).`,
                        false,
                    )
                const code = url.searchParams.get('code')
                const state = url.searchParams.get('state')
                if (!code || !state)
                    return gcalCallbackHtml(
                        'Missing authorization code in the callback.',
                        false,
                    )
                try {
                    const st = await gcalCompleteAuth(code, state)
                    return gcalCallbackHtml(
                        `Connected as ${st.account ?? 'Google Calendar'}. You can close this tab and return to Bismuth.`,
                        true,
                    )
                } catch (e) {
                    return gcalCallbackHtml(
                        `Could not complete sign-in: ${(e as Error).message}`,
                        false,
                    )
                }
            },
        ),

        'POST /gcal/disconnect': onlyWhenGcalEnabled(
            {
                action: 'disconnect',
                message: `Disconnecting Google Calendar is off on this core: ${GCAL_NOT_THE_APP}, so disconnecting here would revoke its refresh token and wipe its sync state.`,
            },
            async (_, __) => {
                await gcalDisconnect()
                return ok({ ok: true })
            },
        ),
    }
}

export function gcalMutatingRoutes(ctx: RouteContext): Record<string, Handler> {
    const { mutatingHandler, readNoteOrNull, cfg } = ctx
    return {
        // Google Calendar two-way sync (Phase 2): reconcile the configured Google calendar with
        // the configured calendar base in both directions (last-write-wins). A vault MUTATION (it
        // rewrites the base file), so it lives here and `pathOf` returns the base path →
        // cache-invalidate + SSE re-render of the open calendar. Config from ctx.appConfig.googleCalendar.
        'POST /gcal/sync': onlyWhenGcalEnabled(
            {
                action: 'manual sync',
                message:
                    'Google Calendar sync is off on this core: it is not the installed Bismuth app, so it may be running on a copy of the vault, and syncing a copy pushes, re-links and deletes events in the real Google Calendar.',
            },
            mutatingHandler(
                async req => {
                    // The calendar to sync is PER-BASE now: the client passes the base path (the calendar
                    // whose settings/tab it came from); the Google calendarId is resolved from THAT base's
                    // frontmatter (falling back to the legacy global mapping for the base it named).
                    const body = (await req.json().catch(() => ({}))) as {
                        basePath?: string
                    }
                    const legacy = legacyGcalConfig(ctx.appConfig)
                    const basePath =
                        (body.basePath && body.basePath.trim()) ||
                        legacy.basePath ||
                        ''
                    if (!basePath)
                        return error(
                            "no calendar base to sync — turn on Google sync in a calendar's settings first",
                            400,
                        )
                    const raw = await readNoteOrNull(cfg.vault, basePath)
                    if (raw === null)
                        return error(
                            `calendar base not found: ${basePath}`,
                            404,
                        )
                    const { config } = parseBaseFile(raw, {
                        name: fileBasename(basePath),
                        path: basePath,
                    })
                    const { calendarId } = resolveGcalConfig(
                        config.view,
                        basePath,
                        legacy,
                    )
                    const { policy, timeZone, theme } = gcalConnectionArgs(
                        ctx.appConfig,
                    )
                    try {
                        return ok(
                            await gcalSync(
                                cfg.vault,
                                basePath,
                                calendarId,
                                policy,
                                timeZone,
                                theme,
                            ),
                        )
                    } catch (e) {
                        return error((e as Error).message, 400)
                    }
                },
                b =>
                    (b?.basePath && String(b.basePath).trim()) ||
                    ctx.appConfig.googleCalendar?.basePath ||
                    undefined,
            ),
        ),
    }
}
