// The `gcal` command group: Google Calendar two-way sync (core/src/gcal/) from the shell. See
// docs/gcal/overview.md for the subsystem itself.
//
// `status` / `connect` / `sync` / `disconnect` are thin wrappers over a RUNNING server's
// `/gcal/*` routes (same `call()`/`resolveCore()` pattern as `app.ts`) — deliberately, not a
// direct import of `core/src/gcal/index.ts`: `sync` needs the server's already-loaded appConfig
// (conflict policy / timezone / theme, resolved by server.ts's `gcalConnectionArgs`), and the
// OAuth/token lifecycle is orchestrated in one place (the server's in-process serialization
// chain in `gcal/index.ts`) so there is exactly one call site for it rather than a second,
// divergent one here.
//
// `targets` and `health` are pure, HEADLESS reads — no server needed — because, per the CLI
// capability audit, neither had any caller reachable from an agent at all before this:
//  - `listGcalSyncTargets` (core/src/gcal/discover.ts) was previously called only by the
//    internal 60s auto-sync ticker in server.ts.
//  - `readManifest` (core/src/gcal/manifest.ts) reads `~/.bismuth/gcal/sync.json`, which lives
//    OUTSIDE any vault — so no vault-scoped command could reach it either, and it needs no
//    running server (it's a plain file read).
//
// `health` needs `--vault` (Task 11): the manifest is now keyed by `manifestKey(vault, basePath)`
// (`${realpath(vault)}::${basePath}`), not by bare basePath alone, so resolving a base's entry
// requires knowing which vault it's for. `health` is READ-ONLY — it must never create, move or
// claim a manifest entry (that's `syncEvents`'s job, gated on `claimLegacy`), so it does its own
// plain lookup here rather than calling `baseSyncFor`.
//
// A pre-namespacing "legacy" bare entry (a key with no `::`) has NO vault association — it could
// belong to any vault that synced before namespacing existed, or none. It is reachable ONLY via
// an explicit single-<basePath> lookup (marked `legacy: true`, never written back), never via
// "list all" — listing it there would misattribute it as THIS vault's history just because this
// vault happened to be the one that ran `gcal health` (found in review, Task 11 fix round 1).
// "List all" (no <basePath>) therefore reports only entries namespaced to the given vault.
import type { CommandMap } from '../types'
import { flag, positionals, fail, out, requireVault } from '../args'
import { call } from '../http'
import { resolveCore } from './app'
import { listGcalSyncTargets } from '../../../core/src/gcal/discover'
import {
    readManifest,
    manifestKey,
    type BaseSync,
} from '../../../core/src/gcal/manifest'
import { loadAppConfig } from '../../../core/src/settings'
import type { LegacyGcalConfig } from '../../../core/src/gcal/config'

/** Wording shown when no running app/server is reachable at `base`. */
const unreachable = (base: string) =>
    `could not reach a running Bismuth server at ${base} — gcal status/connect/sync/disconnect need a running server (\`bismuth serve\`, or the app) — pass --api <url> or start one`

/** This vault's legacy global `googleCalendar.{enabled,calendarId,basePath}` — the migration
 *  fallback `listGcalSyncTargets` consults for the one base the old single mapping named.
 *  Mirrors server.ts's own (private) `legacyGcalConfig(appConfig)` helper; read straight from
 *  settings rather than imported since a running server isn't required for `gcal targets`. */
async function legacyConfig(vault: string): Promise<LegacyGcalConfig> {
    const cfg = await loadAppConfig(vault)
    const gc = cfg.googleCalendar
    return {
        enabled: gc?.enabled,
        calendarId: gc?.calendarId,
        basePath: gc?.basePath,
    }
}

export const commands: CommandMap = {
    'gcal status': {
        summary:
            'Google Calendar connection status: connected?, needs credentials?, account, timezone (requires a running server)',
        usage: '[--api <url>]',
        run: async args =>
            out(
                await call(
                    resolveCore(args),
                    'GET',
                    '/gcal/status',
                    undefined,
                    unreachable,
                ),
                args,
            ),
    },

    'gcal connect': {
        summary:
            'Start Google OAuth: prints the consent URL. A PERSON must finish sign-in in a browser — this cannot complete on its own (requires a running server)',
        usage: '[--client-id <id>] [--client-secret <secret>] [--api <url>]',
        run: async args => {
            const clientId = flag(args, 'client-id')
            const clientSecret = flag(args, 'client-secret')
            if (clientId || clientSecret) {
                if (!clientId || !clientSecret)
                    fail(
                        'usage: gcal connect --client-id <id> --client-secret <secret>',
                    )
                await call(
                    resolveCore(args),
                    'POST',
                    '/gcal/credentials',
                    { clientId, clientSecret },
                    unreachable,
                )
            }
            const res = (await call(
                resolveCore(args),
                'POST',
                '/gcal/auth/start',
                undefined,
                unreachable,
            )) as { url: string }
            out(
                {
                    url: res.url,
                    note:
                        'Open this URL in a browser and sign in to Google — Bismuth cannot complete OAuth without a person present. ' +
                        'Re-run `gcal status` afterward to confirm the connection.',
                },
                args,
            )
        },
    },

    'gcal sync': {
        summary:
            'Two-way sync ONE calendar base against Google now; returns the SyncResult counts (pulled/pushed/deleted/conflicts/…) (requires a running server)',
        usage: '<basePath> [--api <url>]',
        run: async args => {
            const [basePath] = positionals(args)
            if (!basePath) fail('usage: gcal sync <basePath>')
            out(
                await call(
                    resolveCore(args),
                    'POST',
                    '/gcal/sync',
                    { basePath },
                    unreachable,
                ),
                args,
            )
        },
    },

    'gcal disconnect': {
        summary:
            'Disconnect Google Calendar: revokes the token and wipes local sync state. Permanent — event links are not recoverable (requires a running server)',
        usage: '[--api <url>]',
        run: async args =>
            out(
                await call(
                    resolveCore(args),
                    'POST',
                    '/gcal/disconnect',
                    undefined,
                    unreachable,
                ),
                args,
            ),
    },

    'gcal targets': {
        summary:
            'List calendar bases with Google sync enabled — the same scan the auto-sync ticker runs (headless: reads the vault + settings directly, no server needed)',
        usage: '',
        run: async args => {
            const vault = requireVault(args)
            const legacy = await legacyConfig(vault)
            out(await listGcalSyncTargets(vault, legacy), args)
        },
    },

    'gcal health': {
        summary:
            'Per-base sync state from ~/.bismuth/gcal/sync.json (outside the vault — no other command can reach it): last-sync time + linked-event count. ' +
            "Per-sync conflict counts are NOT persisted here — see `gcal sync`'s own output for those. Omit <basePath> to list every NAMESPACED base for this vault only " +
            '(a legacy, pre-namespacing entry has no vault association, so it is never listed here — pass its exact <basePath> to see it). ' +
            'READ-ONLY: with an explicit <basePath>, a legacy entry that has not yet been claimed by a real sync is still shown (marked `legacy: true`) but is never created, moved or modified.',
        usage: '--vault <dir> [<basePath>]',
        run: async args => {
            const vault = requireVault(args)
            const [basePath] = positionals(args)
            const manifest = readManifest()

            // Namespaced lookup first; only when ABSENT does a legacy (pre-namespacing) bare
            // entry get read. Never writes, moves or creates anything — that's `baseSyncFor`'s
            // job, reserved for an actual sync (see core/src/gcal/manifest.ts).
            const summarize = (path: string) => {
                let bs = manifest.bases[manifestKey(vault, path)]
                let legacy = false
                if (!bs) {
                    bs = manifest.bases[path]
                    legacy = !!bs
                }
                if (!bs) bs = { links: {} } as BaseSync // report zeros; never persisted
                return {
                    basePath: path,
                    calendarId: bs.calendarId,
                    lastSyncAt: bs.lastSyncAt,
                    linkedEvents: Object.keys(bs.links).length,
                    hasSyncToken: !!bs.syncToken,
                    ...(legacy ? { legacy: true } : {}),
                }
            }

            if (basePath) {
                out(summarize(basePath), args)
                return
            }
            // No <basePath>: every NAMESPACED base path for THIS vault only — i.e. every key
            // equal to manifestKey(vault, <basePath>). A legacy (pre-namespacing) bare entry has
            // no vault association at all, so it is deliberately excluded here: listing it under
            // ANY vault's "list all" would misattribute someone else's (or nobody's) sync history
            // as this vault's. It is still reachable — and still marked `legacy: true` — through
            // the explicit single-<basePath> lookup above, which is an intentional, named lookup
            // rather than an inference from the whole manifest.
            const prefix = manifestKey(vault, '')
            const nsPaths = Object.keys(manifest.bases)
                .filter(k => k.startsWith(prefix))
                .map(k => k.slice(prefix.length))
            out(nsPaths.map(summarize), args)
        },
    },
}
