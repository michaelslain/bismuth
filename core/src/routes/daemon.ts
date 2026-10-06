import {
    daemonStatus,
    listDevices,
    setOwner,
    setCronEnabled,
    setProcessEnabled,
    runCron,
    deleteCron,
    deleteProcess,
    vaultDaemonDir,
    daemonIdentityName,
} from '../daemon'
import { daemonSnapshot } from '../daemonGraph'
import { readActivity } from '../daemonActivity'
import {
    listDaemonPages,
    resolvePage,
    markPageFailed,
    archivePage,
    createDaemonPage,
    type CreatePageInput,
} from '../daemonPages'
import { installStatus, runSetup } from '../daemonInstall'
import { ok, error, type Handler, type RouteContext } from './context'

export default function daemonRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { requestChannel, cfg } = ctx
    return {
        // Daemon supervision. These read the shared machine-identity state files under the
        // daemon machine dir (BISMUTH_DAEMON_DIR, default ~/.bismuth/daemon) that the daemon
        // authors; vault-independent, so they live here regardless of cfg.vault.
        'GET /daemon/status': async (_, __) => {
            // Augmented with THIS vault's daemon identity name (identity.md frontmatter) — the chat
            // surface presents as the daemon, so the client needs its name alongside liveness.
            return ok({
                ...daemonStatus(),
                name: daemonIdentityName(cfg.vault),
            })
        },

        'GET /daemon/devices': async (_, __) => {
            return ok(listDevices())
        },

        // The daemon page's crons + background services for THIS vault, read straight from the
        // vault's `.daemon` dir (never throws → empty lists). Liveness is machine-level. Polled
        // by the daemon page.
        'GET /daemon/snapshot': async (_, __) => {
            return ok(
                daemonSnapshot(
                    vaultDaemonDir(cfg.vault),
                    daemonIdentityName(cfg.vault),
                ),
            )
        },

        // The daemon's activity log for THIS vault: cron outcomes, process lifecycle, brain starts,
        // newest first. A plain read of <vault>/.daemon/logs — never throws, degrades to [] when the
        // daemon has never run here. This is what lets a chat session answer "what have you been
        // doing?" with evidence instead of a guess.
        'GET /daemon/logs': async (_, url) => {
            const limitParam = url.searchParams.get('limit')
            return ok(
                readActivity(vaultDaemonDir(cfg.vault), {
                    limit: limitParam ? Number(limitParam) : undefined,
                    kind: url.searchParams.get('kind') ?? undefined,
                    name: url.searchParams.get('name') ?? undefined,
                    since: url.searchParams.get('since') ?? undefined,
                }),
            )
        },

        // Daemon install/setup, bridged to the bundled daemon binary's CLI surface
        // (core/src/daemonInstall.ts → `bismuth-daemon --status` / `--ensure-installed`).
        // Read-only install probe + a one-shot setup action — both system actions,
        // NOT vault mutations, so they live in the READ routes (like POST /open-folder),
        // never through mutatingHandler. installStatus() never throws; runSetup() is
        // adopt-only (it does nothing when the daemon is already installed/running).
        'GET /daemon/install': async (_, __) => {
            return ok(await installStatus())
        },

        'POST /daemon/setup': async (_, __) => {
            return ok(await runSetup())
        },

        // The daemon ships as a bundled binary that updates WITH the app (no git pull / self-
        // update path anymore), so "update" just re-runs the idempotent, adopt-only install to
        // (re-)register the launchd/systemd service. System action, not a vault mutation → READ
        // routes. Idempotent (adopts an already-installed/running daemon).
        'POST /daemon/update': async (_, __) => {
            return ok(await runSetup())
        },

        // Daemon supervision WRITES: enable/disable a cron or process (edits the `enabled`
        // frontmatter in the shared <home>/{crons,processes}/<name>.md), run a cron on command
        // (drops a trigger file the daemon polls). These mutate the daemon's shared files, NOT
        // the vault — so, like POST /daemon/setup and the /relay/* hooks, they live in the READ
        // routes (no vault-cache invalidation; the frontend re-polls /daemon/snapshot). Unknown name →
        // setCronEnabled/runCron throw AppError ("ENOENT") → 404 via the dispatch catch.
        // Owner-gated, all five of them (these three plus the two deletes below): CORS is `*`,
        // so any local page could otherwise flip/run/delete a service or cron. There is no create
        // route: crons and services are created by the daemon in chat, through the headless
        // `bismuth daemon cron|process create` CLI (core's createCron/createProcess). The
        // daemon itself never calls these routes — it acts on its own files directly and,
        // for anything vault-facing, through the headless CLI — so gating loses it nothing.
        'POST /daemon/cron/toggle': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { name, enabled } = (await req.json()) as {
                name?: string
                enabled?: boolean
            }
            if (
                typeof name !== 'string' ||
                !name ||
                typeof enabled !== 'boolean'
            )
                return error('missing name/enabled', 400)
            setCronEnabled(name, enabled, vaultDaemonDir(cfg.vault))
            return ok({ ok: true })
        },

        'POST /daemon/cron/run': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { name } = (await req.json()) as { name?: string }
            if (!name) return error('missing name', 400)
            runCron(name, vaultDaemonDir(cfg.vault))
            return ok({ ok: true })
        },

        'POST /daemon/process/toggle': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { name, enabled } = (await req.json()) as {
                name?: string
                enabled?: boolean
            }
            if (
                typeof name !== 'string' ||
                !name ||
                typeof enabled !== 'boolean'
            )
                return error('missing name/enabled', 400)
            setProcessEnabled(name, enabled, vaultDaemonDir(cfg.vault))
            return ok({ ok: true })
        },

        // Delete a cron/process definition. Response `{ ok: true }`. Unknown name → 404; a
        // running cron → 409 (EBUSY) via the dispatch catch, same as the routes above.
        'POST /daemon/cron/delete': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { name } = (await req.json()) as { name?: string }
            if (typeof name !== 'string' || !name)
                return error('missing name', 400)
            deleteCron(name, vaultDaemonDir(cfg.vault))
            return ok({ ok: true })
        },

        'POST /daemon/process/delete': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { name } = (await req.json()) as { name?: string }
            if (typeof name !== 'string' || !name)
                return error('missing name', 400)
            deleteProcess(name, vaultDaemonDir(cfg.vault))
            return ok({ ok: true })
        },

        // The daemon "inbox": pages the daemon authored under .daemon/pages/*.md asking the user to
        // approve/dismiss an action (see core/src/daemonPages.ts). Read-only despite the GC side
        // effect (deleting long-resolved pages is an implementation detail of "list", not a vault
        // mutation the frontend needs to react to specially), so it lives in the READ table like the
        // other /daemon/* routes above — the frontend just polls it.
        'GET /daemon/pages': async (_, __) => {
            // ctx.appConfig.daemon.inboxRetentionDays mirrors the settings-schema default (see
            // schema/settingsSchema.ts's daemon.inboxRetentionDays) when settings.yaml hasn't loaded yet.
            return ok(
                listDaemonPages(
                    cfg.vault,
                    ctx.appConfig.daemon?.inboxRetentionDays ?? 7,
                ),
            )
        },

        // Resolve a pressed action: approve (has a `prompt`) writes the sidecar to "working" and
        // drops a trigger the daemon's processPageTriggers polls; dismiss (no `prompt`) resolves
        // entirely here. NOT a vault mutation (the page .md itself is untouched — only its sidecar
        // under .daemon/pages/.state/ changes), so, like /daemon/cron/toggle, it lives in the READ
        // table — no cache-invalidate; the frontend re-polls GET /daemon/pages.
        'POST /daemon/pages/resolve': async req => {
            const { path, actionId } = (await req.json()) as {
                path?: string
                actionId?: string
            }
            if (!path || !actionId) return error('missing path/actionId', 400)
            return ok(resolvePage(cfg.vault, path, actionId))
        },

        // Belt-and-suspenders client escape hatch (plan §5): force the sidecar to "failed" with no
        // daemon involvement, for a page stuck "working" implausibly long (the daemon process died
        // mid-run). Same READ-table reasoning as the route above.
        'POST /daemon/pages/mark-failed': async req => {
            const { path } = (await req.json()) as { path?: string }
            if (!path) return error('missing path', 400)
            markPageFailed(cfg.vault, path)
            return ok({ ok: true })
        },

        // Archive a page from the daemon page's inbox = delete the page + its sidecar outright
        // (archivePage). Structural, but the watcher already bumps `tree` for a .daemon/pages
        // change (DAEMON_PAGE_RE) and the frontend re-polls, so it rides the READ table like the
        // routes above. Owner-gated: CORS is `*`, so any local page could otherwise delete it.
        'POST /daemon/pages/archive': async req => {
            if (requestChannel(req) !== 'owner') return error('forbidden', 403)
            const { path } = (await req.json()) as { path?: string }
            if (typeof path !== 'string' || !path)
                return error('missing path', 400)
            archivePage(cfg.vault, path)
            return ok({ ok: true })
        },
    }
}

export function daemonMutatingRoutes(
    ctx: RouteContext,
): Record<string, Handler> {
    const { mutatingHandler, cfg } = ctx
    return {
        // Author a daemon inbox page with validated frontmatter (core/src/daemonPages.ts's
        // createDaemonPage). A genuine vault write (the page .md lands under .daemon/pages/ and shows in
        // the sidebar), so — unlike the /daemon/pages/{resolve,mark-failed} sidecar writes in the READ
        // table — this is a MUTATION: `pathOf` returns the new page path so classifyVault (DAEMON_PAGE_RE)
        // marks the tree dirty and the inbox refreshes. Exposed via the `page` CLI group so an MCP/daemon
        // caller creates a well-formed page instead of a fragile raw file write (still zero new MCP tools).
        'POST /daemon/pages': mutatingHandler(
            async req => {
                const body = (await req.json()) as CreatePageInput
                return ok(createDaemonPage(cfg.vault, body))
            },
            b =>
                typeof b?.slug === 'string' && b.slug
                    ? `.daemon/pages/${b.slug}.md`
                    : undefined,
        ),

        // Claim a device as the daemon owner: write owner.json (byte-compatible
        // with what the daemon reads). owner.json lives outside the vault, so there's
        // nothing in the graph/tree caches to invalidate — pass a stable constant scope
        // (no vault path) so the mutating handler's path-derived invalidation is a no-op.
        'POST /daemon/owner': mutatingHandler(
            async req => {
                const { deviceId } = (await req.json()) as {
                    deviceId?: unknown
                }
                if (typeof deviceId !== 'string' || deviceId.length === 0) {
                    return error('missing deviceId', 400)
                }
                try {
                    return ok(setOwner(deviceId))
                } catch (e) {
                    // setOwner throws when deviceId isn't a known, heartbeating device.
                    return error((e as Error).message, 400)
                }
            },
            () => '::daemon-owner',
        ),
    }
}
