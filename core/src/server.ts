import { join } from 'node:path'
import { statSync, readdirSync } from 'node:fs'
import { createSseRegistry } from './sse'
import { createAsyncCache, type AsyncCache } from './asyncCache'
import { createSelfWriteMarks } from './selfWriteMarks'
import { watchLive, type LiveWatcher } from './liveWatch'
import { buildGraph } from './engine'
import { attachLayout, computeViewLayouts, layoutEpoch } from './layout-cache'
import { listTree, readNote } from './files'
import { scheduleBackup, snapshotMessage } from './backup'
import {
    runTaskMigration,
    emptyReport as emptyMigrationReport,
    type MigrationReport,
} from './taskMigrateRun'
import { AppError } from './error'
import { buildVaultRows, patchVaultRows } from './basesData'
import { buildTaskRows, patchTaskRows } from './bases/tasksData'
import type { GraphData, TreeEntry } from './graph'
import type { Row } from './bases/types'
import {
    createTerminalSession,
    killSession,
    resizeSession,
    getSession,
    getSessionByTermId,
    scheduleSessionKill,
    cancelSessionKill,
    claimPooledSession,
    attachSink,
    detachSink,
    prewarmPool,
    setPoolMemoryDir,
} from './terminal'
// Chat verbs route through the PROVIDER router (core/src/chatProviders/) so each chat session can
// run on Claude Code (chat.ts) or opencode (chatProviders/opencode.ts) — same ChatFrame protocol.
import {
    sendMessage as chatSend,
    abortTurn as chatAbort,
    closeChat,
    scheduleClose as scheduleChatClose,
    rebindSink as chatRebindSink,
    detachSink as chatDetachSink,
    newChatId,
    respondPermission as chatRespondPermission,
    respondQuestion as chatRespondQuestion,
    setPermissionMode as chatSetPermissionMode,
    setModel as chatSetModel,
    setEffort as chatSetEffort,
    resumeSession as chatResume,
    openSession as chatOpen,
} from './chatProviders'
import { resolveBackendId } from './agentBackends/catalog'
import { opencodeClient } from './chatProviders/opencode/opencode'
import { installedBackendIds } from './freeAgent'
import {
    registerWindow,
    unregisterWindow,
    updateTabs,
    resolveReply,
    type UiTabsSnapshot,
} from './uiControl'
import { writeRunRecord } from './runRegistry'
import { pruneTmpFiles } from './tmpFiles'
import {
    mintOwnerToken,
    resolveRequestChannel,
    type RequestChannel,
} from './ownerToken'
import { isThemePath } from './theme/customTheme'
import {
    isHidden,
    isWatchIgnored,
    isSystemFolderPath,
    isDaemonMemoryPath,
    isDaemonMemoryNoise,
    skipWatchWalk,
} from './watchSkip'
import {
    createChangeTracker,
    createThemeFileTracker,
    isSettingsPath,
    flushDelayMs,
} from './changeClassifier'
import {
    reconcileSettings,
    loadAppConfig,
    readDaemonEnabledSync,
    readMcpRegisterWith,
    type AppConfig,
    SETTINGS_FILE,
    readSettings,
} from './settings'
import { normalizeStatusBar } from './statusBarItems'
import { createStatusRunner } from './statusBarRun'
import {
    buildDenyPaths,
    type DenyEntry,
    type VisibilityChannel,
} from './visibility'
import { DEFAULTS as SETTINGS_DEFAULTS } from './schema/settingsSchema'
import { invalidateSearchIndex, updateSearchIndex } from './search'
import {
    migrateDaemonState,
    daemonIdentityName,
    registerVaultRoot,
} from './daemon'
import { DAEMON_PAGE_RE } from './daemonPages'
import { installDaemonFromBundle } from './daemonInstall'
import { ensureBismuthInstalled } from './bismuthInstall'
import { bootDoctor } from './doctor/routes'
import { status as gcalStatus, sync as gcalSync } from './gcal'
import { listGcalSyncTargets } from './gcal/discover'
import { gcalAutoSyncEnabled } from './gcal/manifest'
import {
    error,
    withCors,
    type Handler,
    type RouteContext,
} from './routes/context'
import { default as agentsRoutes } from './routes/agents'
import { default as basesRoutes, basesMutatingRoutes } from './routes/bases'
import { default as daemonRoutes, daemonMutatingRoutes } from './routes/daemon'
import { default as gcalRoutes, gcalMutatingRoutes } from './routes/gcal'
import { default as graphRoutes } from './routes/graph'
import { default as relayRoutes } from './routes/relay'
import {
    default as settingsRoutes,
    settingsMutatingRoutes,
} from './routes/settings'
import { default as systemRoutes } from './routes/system'
import { default as tasksRoutes, tasksMutatingRoutes } from './routes/tasks'
import { default as vaultRoutes, vaultMutatingRoutes } from './routes/vault'
import { gcalConnectionArgs, legacyGcalConfig } from './routes/gcal'

export interface CoreConfig {
    vault: string
    memory?: string
    port?: number
    /** Test seam for the /opencode/* routes: resolves the shared opencode server's client, or null
     *  when opencode is absent. Defaults to the real lookup. A rejection counts as null. */
    opencodeClient?: () => Promise<Awaited<ReturnType<typeof opencodeClient>>>
}

const enc = new TextEncoder()
const dec = new TextDecoder()

// How long a terminal PTY survives an ABNORMAL websocket close (reload, network
// drop) before being killed — the window in which a reconnecting client can
// reattach by termId and keep its running shell. Clean closes (code 1000) kill
// immediately, so this never delays teardown of a deliberately-closed tab.
// Overridable via BISMUTH_TERMINAL_GRACE_MS (tests use a short window).
const reattachGraceMs = (): number =>
    Number(process.env.BISMUTH_TERMINAL_GRACE_MS) || 30_000

// How long a CHAT session survives an ABNORMAL websocket close (reload, network drop) before being
// torn down — the window in which a reconnecting client can rebind by chatId and keep its
// conversation, mid-turn frames and all. Clean closes (code 1000) tear down immediately, so this
// never delays teardown of a deliberately-closed chat tab.
//
// Overridable via BISMUTH_CHAT_GRACE_MS, exactly as reattachGraceMs() is for terminals above and
// for the same reason: the close path's behaviour — "was a teardown armed, or correctly NOT armed?"
// — is only observable by waiting it out, and 30s is not a wait any test can make. Read fresh on
// every call (not captured at boot) so a test can set it around a single createServer().
const chatGraceMs = (): number =>
    Number(process.env.BISMUTH_CHAT_GRACE_MS) || 30_000

// Poll period of the background Google-Calendar auto-sync ticker (see createServer's tail). In
// production this is a fixed 60s poll whose EFFECTIVE cadence is the longer
// `googleCalendar.syncIntervalMinutes` debounce applied inside the tick, so shortening it here
// changes when the tick runs, not how often a sync happens.
//
// Overridable via BISMUTH_GCAL_TICK_MS for the same reason reattachGraceMs()/chatGraceMs() are:
// "did a tick happen (or, after stop(), correctly not happen)?" is only observable by waiting one
// out, and 60s is not a wait any test can make. Read fresh on every call so a test can set it
// around a single createServer().
const gcalTickMs = (): number =>
    Number(process.env.BISMUTH_GCAL_TICK_MS) || 60_000

// Floor under the configurable fileWatchDebounceMs (min 50ms) for how long a self-write mark
// stays armed once RE-armed (see selfWriteMarks.ts's rearm()) after its write resolves. The
// debounce alone isn't enough headroom: a write that itself takes longer than the debounce (a
// big rename, a slow disk) would otherwise have its mark expire before the watcher even notices
// the write, letting the echo through as a second, spurious change.
const SELF_WRITE_GRACE_MS = 2000

export function cliArg(name: string): string | undefined {
    const i = Bun.argv.indexOf(`--${name}`)
    return i >= 0 ? Bun.argv[i + 1] : undefined
}

/** Matches a daemon cron/process DEFINITION file (.daemon/{crons,processes}/<name>.md) —
 *  hoisted out of isDaemonRuntimeNoise (called per file-watch event) since it's stateless. */
const DAEMON_DEF_RE = /^\.daemon\/(crons|processes)\/[^/.][^/]*\.md$/

export function createServer(cfg: CoreConfig) {
    // Backend runtime config (settings.yaml merged over defaults). Seeded synchronously
    // from DEFAULTS so timings are sane before the async load lands, then refreshed on
    // boot and whenever settings.yaml changes (see classifyVault). Declared BEFORE
    // reconcileSettings (below) so the self-write marks constructed off it can be used to mark
    // that call's own boot-time write.
    let appConfig: AppConfig = SETTINGS_DEFAULTS as unknown as AppConfig
    // Reflect the on-disk daemon.enabled SYNCHRONOUSLY before the first cache warm (below).
    // The tree gates the `.daemon` folder and the graph gates the 3rd brain on this flag, so
    // the FIRST cached /tree + /graph build (treeCache/graphCache.warm()) must already see the
    // real value — otherwise the DEFAULTS-seeded `false` makes that first build omit `.daemon`
    // (and the 3rd brain), and they only pop in a beat later once the async loadAppConfig below
    // resolves and re-invalidates (worse on a cold-boot SSE miss → up to the 5s /version poll).
    // Mirrors daemonIdentityName's sync identity.md read. A fresh object so the shared
    // SETTINGS_DEFAULTS is never mutated; the async load still reassigns appConfig wholesale.
    const daemonEnabledAtBoot = readDaemonEnabledSync(cfg.vault)
    if (daemonEnabledAtBoot !== (appConfig.daemon?.enabled ?? false)) {
        appConfig = {
            ...SETTINGS_DEFAULTS,
            daemon: {
                ...(SETTINGS_DEFAULTS as { daemon: Record<string, unknown> })
                    .daemon,
                enabled: daemonEnabledAtBoot,
            },
        } as unknown as AppConfig
    }

    // Self-write suppression marks (core/src/selfWriteMarks.ts) — constructed here, before
    // reconcileSettings runs, so that call's own `.settings` write can be marked too (see
    // below). debounceMs reads `appConfig` live, so a settings change that adjusts
    // fileWatchDebounceMs takes effect on the next mark without reconstructing this.
    const selfWriteMarks = createSelfWriteMarks({
        now: Date.now,
        debounceMs: () => appConfig.server.fileWatchDebounceMs,
        graceMs: SELF_WRITE_GRACE_MS,
        stampOf: rel => {
            try {
                const st = statSync(join(cfg.vault, rel))
                return `${st.mtimeMs}:${st.size}`
            } catch {
                return null
            }
        },
    })
    function markSelfWritten(paths: string[]): void {
        selfWriteMarks.mark(paths)
    }
    /** Re-arm paths whose write just resolved — see mutatingHandler and PUT /file. */
    function rearmSelfWritten(paths: string[]): void {
        selfWriteMarks.rearm(paths)
    }
    function consumeSelfWritten(path: string): boolean {
        return selfWriteMarks.consume(path)
    }
    function unmarkSelfWritten(paths: string[]): void {
        selfWriteMarks.unmark(paths)
    }

    // On boot: reconcile settings.yaml against SETTINGS_SCHEMA — write a fresh
    // defaults file if absent, or fill in any keys added since the file was written
    // (preserving the user's values, comments, and unknown keys). Fire-and-forget so
    // server start stays synchronous; the write lands within ms. Swallow failures
    // (e.g. a non-existent/read-only vault dir in tests) so it can never take the
    // whole server down on boot.
    //
    // Marked self-written like any other write this server performs: reconcileSettings only
    // actually writes `.settings` when it's missing or under-filled (most boots: no-op), but an
    // unmarked write here leaked a spurious version bump the moment the watcher noticed it —
    // flaking core/test/server.bootConfig.test.ts under load. Rearmed only when it actually
    // wrote (reconcileSettings's return value); on a no-op run, or a throw, the mark is taken
    // back off instead — otherwise `.settings` stays armed for the full 2s grace window with
    // nothing on disk to ever produce the echo that would consume it, and a real external
    // `.settings` edit landing in that window would be silently swallowed as a phantom echo.
    markSelfWritten([SETTINGS_FILE])
    // Kept (never rejects) so GET /settings can wait for it: serializing a fully materialized
    // legacy `.settings` BEFORE the reconcile strips its defaults folds all the legacy keys into
    // `appearance.tokens`, pinning them over the active theme for that first load.
    const bootReconcile: Promise<void> = reconcileSettings(cfg.vault)
        .then(wrote => {
            if (wrote) rearmSelfWritten([SETTINGS_FILE])
            else unmarkSelfWritten([SETTINGS_FILE])
        })
        .catch(() => unmarkSelfWritten([SETTINGS_FILE]))

    // On boot: convert this vault's emoji task syntax to bracket fields, once. The emoji
    // spelling has no reader any more (core/src/taskLegacy.ts says why), so an un-migrated
    // vault silently loses every date, priority and recurrence it has — the pass takes a
    // local git snapshot first and aborts rather than writing if that snapshot fails
    // (core/src/taskMigrateRun.ts). The report is held for GET /tasks/migration, which the app
    // polls once on mount to toast what changed; `null` means the pass has not finished yet,
    // NOT that it found nothing.
    //
    // The actual call is DEFERRED until treeCache.get() settles (see the boot warm-up chain
    // below) — this scan reads every markdown file in the vault, which used to run in the same
    // breath as the graph and tree builds and steal CPU from both on a large vault. But the
    // SKIP decision itself must stay synchronous, right here: core/test/server.test.ts sets
    // BISMUTH_NO_TASK_MIGRATE around a single synchronous createServer() call and deletes it
    // immediately after, so a deferred read would see it already unset.
    let taskMigration: MigrationReport | null = null
    const skipTaskMigrate = process.env.BISMUTH_NO_TASK_MIGRATE === '1'

    // Boot-time: install/refresh the bundled daemon as a launchd/systemd service so it keeps
    // running while the app is closed. No-op in dev (no BISMUTH_DAEMON_BUNDLE); best-effort.
    void installDaemonFromBundle()

    // Boot-time: make this vault DISCOVERABLE to the daemon by registering its root in the
    // machine-level vaults.json registry (daemon/src/lib/registry.ts's loadEnabledVaults()
    // iterates this every cron tick — a vault absent from it never fires a single cron, no
    // matter how its own daemon.enabled is set). Unconditional (not gated on daemon.enabled):
    // the daemon re-checks each vault's own .settings itself. Idempotent; best-effort.
    registerVaultRoot(cfg.vault)

    // /graph, /tree, and the unscoped vault feeds (rows + tasks) all go through a deduped,
    // invalidation-safe cache (see asyncCache.ts): concurrent first requests share ONE build,
    // and a file change mid-build won't repopulate a stale value. This matters most for rows:
    // one SSE event can fan out to N independent /rows resolves (one per open base/calendar pane),
    // and a bare lazy cache would let each kick off its own full-vault walk concurrently.
    // The 3rd brain (memory) is gated on the daemon: when enabled, memory lives at
    // <vault>/.daemon/memory; when disabled there is no 3rd brain at all (undefined →
    // engine skips buildMemoryGraph + the about-edges, emitting no mem: nodes). Resolved
    // live from appConfig so a daemon.enabled toggle adds/removes the 3rd brain.
    const effectiveMemoryDir = (): string | undefined =>
        appConfig.daemon?.enabled
            ? join(cfg.vault, '.daemon', 'memory')
            : undefined
    // The view warm-up (warmViews, end of createServer) is UNREQUESTED work — nothing awaits it — so a pass
    // that is IN FLIGHT is cancelled the moment the graph is invalidated: its full settle must never hold the
    // one layout worker ahead of the rebuild that invalidation asks for. See the cancellation rule in
    // layout-cache.ts's layoutFor. Each pass creates its OWN controller when it starts and clears it when it
    // ends, so an invalidation that lands before a pass starts cancels nothing: one controller shared for the
    // life of the process was already aborted by then (an early daemon memory write was enough), and the
    // warm-up never ran even for the fresh graph. Aborted from graphCache.invalidate() itself, so no
    // invalidation path can miss a running one; the same call wakes warmViews for its next pass.
    let viewWarmup: AbortController | null = null
    let wakeViewWarmup: () => void = () => {}
    // Set by stop(): warmViews must not start (or keep) layout work for a server nobody can reach any
    // more. The layout worker is ONE per process, fed FIFO, so a stopped server's leftover graph build +
    // view warm-up would otherwise run ahead of every later server's jobs.
    let stopped = false
    const graphLayoutCache = createAsyncCache<GraphData>(async signal => {
        // The rename epoch is captured BEFORE the vault walk: a POST /move landing while buildGraph reads
        // the old tree must void this build's seed write even when the build is a full settle, which
        // ignores its signal (layout-cache.ts renameEpoch + layoutFor).
        const epoch = layoutEpoch(cfg.vault)
        return attachLayout(
            await buildGraph(cfg.vault, effectiveMemoryDir()),
            cfg.vault,
            { signal, epoch },
        )
    })
    const graphCache: AsyncCache<GraphData> = {
        ...graphLayoutCache,
        invalidate() {
            graphLayoutCache.invalidate()
            viewWarmup?.abort()
            wakeViewWarmup()
        },
    }
    const treeCache = createAsyncCache<TreeEntry[]>(() =>
        listTree(cfg.vault, {
            daemonEnabled: appConfig.daemon?.enabled,
            daemonName: daemonIdentityName(cfg.vault),
        }),
    )
    // The unscoped vault feeds, shared by /vault-data, /rows, and the source resolver.
    const rowsCache = createAsyncCache<Row[]>(() => buildVaultRows(cfg.vault))
    const tasksCache = createAsyncCache<Row[]>(() =>
        buildTaskRows(cfg.vault, undefined),
    )
    // ONE runner for the server's life so a `run:` item's `every` cache spans requests.
    const statusRunner = createStatusRunner({ vault: cfg.vault })
    const statusItems = async () =>
        normalizeStatusBar((await readSettings(cfg.vault))?.data.statusBar)
    let version = 0
    const sse = createSseRegistry()

    // Load the real settings.yaml over DEFAULTS. daemon.enabled was already read SYNCHRONOUSLY
    // above (readDaemonEnabledSync) before the first cache warm, so on the overwhelming majority
    // of boots this async load reconfirms a value the caches already have — invalidating and
    // bumping the version unconditionally threw away the graph/tree builds already in flight and
    // forced every already-connected client through a wasted SSE-triggered refetch. Only actually
    // invalidate when daemon.enabled turns out to have changed since that sync read (settings.yaml
    // was edited in the instant between the sync read and this resolving, or the sync read itself
    // failed and fell back). (Defined after the caches so we can reference them here.)
    void loadAppConfig(cfg.vault)
        .then(c => {
            const prevDaemon = appConfig.daemon?.enabled ?? false
            appConfig = c
            // First boot after upgrade: if this vault's daemon is enabled, copy any legacy
            // ~/.claude-bot brain into <vault>/.daemon (copy-only — never deletes the source).
            // Machine-marker-gated, so it lands in exactly one vault. Runs before the cache
            // rebuilds below so the migrated memory shows up immediately.
            if (c.daemon?.enabled) migrateDaemonState(cfg.vault)
            // Re-bake the warm pool with the now-known memory dir so the first terminal tab
            // injects (or doesn't) per the loaded daemon.enabled, not the DEFAULTS-seeded state.
            setPoolMemoryDir(effectiveMemoryDir())
            if ((c.daemon?.enabled ?? false) === prevDaemon) return
            treeCache.invalidate()
            graphCache.invalidate()
            // Notify any already-connected client to refetch — daemon.enabled in the loaded
            // config may add the 3rd brain (graph) and the .daemon folder (tree) that the
            // DEFAULTS-seeded boot state did not have.
            version++
            sse.publish({
                version,
                paths: [],
                dirty: { graph: true, tree: true },
            })
        })
        .catch(() => {})

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    // When the current pending batch received its first event (0 = no batch pending).
    // Bounds the resetting debounce — see flushDelayMs.
    let firstPendingAt = 0
    let pendingVault = new Set<string>()
    let pendingVaultUnknown = false
    let pendingMemory = false

    // markSelfWritten/rearmSelfWritten/consumeSelfWritten/unmarkSelfWritten are defined above
    // (constructed before reconcileSettings, from core/src/selfWriteMarks.ts) — a path this
    // server is ABOUT TO WRITE is marked BEFORE the write happens (see mutatingHandler and
    // PUT /file below), not confirmation that it succeeded or published. The OS watcher notices
    // the same write a beat later (see the `watch()` callback below) and would otherwise replay
    // an identical structural wave — doubling every graph/tree rebuild on a rename, where
    // diffFingerprints marks a vanished/new path dirty unconditionally. consumeSelfWritten at
    // the watcher callback deletes the entry on the very first check, so at most ONE watcher
    // event is swallowed per write: a genuine external write to the same path — the CLI, an
    // agent, a `git checkout`, the daemon — landing after our own echo has already been consumed
    // still schedules normally. If the write never happens — mutatingHandler's run() throws, OR
    // it resolves but returns a >=400 response (several routes reject that way on their everyday
    // failure paths instead of throwing) — the mark is undone; see unmarkSelfWritten. So a
    // failed request can't leave a path armed with nothing to echo. rearmSelfWritten is called
    // once the write actually RESOLVES, extending the expiry so a write slower than the debounce
    // (a big rename, a slow disk) doesn't let its own echo through — see selfWriteMarks.ts.

    // Tracks each note's graph/tree-relevant fingerprint (wikilinks + tags + icon),
    // so we can stay silent toward graph/tree consumers when a file is rewritten
    // without changing its connections — e.g. a bot status file restamped every
    // couple of seconds.
    const tracker = createChangeTracker()
    // `.themes/*.yaml` files already present at boot, so the first autosave of one is an edit.
    const themeFileExists = (rel: string) => {
        try {
            return statSync(join(cfg.vault, rel)).isFile()
        } catch {
            return false
        }
    }
    const themeFiles = createThemeFileTracker(
        (() => {
            try {
                return readdirSync(join(cfg.vault, '.themes'))
                    .map(n => `.themes/${n}`)
                    .filter(isThemePath)
            } catch {
                return []
            }
        })(),
    )
    // Watcher path predicates (dot-hidden, DAEMON.md heartbeat, .daemon system folders, memory
    // noise) are pure and live in ./watchSkip.ts, with their reasons.
    // The daemon writes high-frequency runtime state under .daemon while it runs — process logs,
    // pid/session files, cron .running.json/.last-fired.json/.triggers. None of it changes the
    // sidebar or the graph, so reacting to it (cache invalidate → version bump → SSE → full
    // /tree or /graph rebuild) is pure churn — the same reason DAEMON_STATUS_FILE is dropped
    // above. A .daemon path is "noise" UNLESS it's the 3rd brain (.daemon/memory/**), a cron/
    // process DEFINITION file (.daemon/{crons,processes}/<name>.md), or a daemon INBOX page
    // (.daemon/pages/<slug>.md) — all three the sidebar/graph show. A page's dynamic sidecar
    // (.daemon/pages/.state/**) and trigger dir (.daemon/pages/.triggers/**) stay dot-prefixed,
    // so they're still noise (correct — their churn shouldn't bump the tree).
    const isDaemonRuntimeNoise = (p: string) =>
        isDaemonMemoryNoise(p) ||
        (p.startsWith('.daemon/') &&
            !isDaemonMemoryPath(p) &&
            p !== '.daemon/identity.md' && // the user-editable personality file — show it in the sidebar
            p !== '.daemon/PAGES.md' && // the seeded page-format guide — show it in the sidebar (explicit allowlist, not "any root .md", so future runtime files stay noise)
            !DAEMON_DEF_RE.test(p) &&
            !DAEMON_PAGE_RE.test(p))

    // Clear only the caches a change touched, bump version, and tell subscribers
    // exactly what's dirty. We always bump version (so the editor can reconcile an
    // externally-edited open file), but graph/tree consumers skip refetching when
    // their `dirty` flag is false.
    async function applyDirty(
        paths: string[],
        dirty: { graph: boolean; tree: boolean },
        vaultTouched = true,
    ) {
        if (dirty.graph) graphCache.invalidate()
        if (dirty.tree) treeCache.invalidate()
        // Search index, rows, and tasks are all built purely from vault notes, so a batch that
        // touched only the memory dir (3rd brain, no vault paths) has nothing for them to react
        // to — skip the drop/rebuild entirely so a daemon memory write doesn't force the next
        // /search, /rows, or /tasks request to pay a full vault re-walk for no content change.
        if (vaultTouched) {
            // The search index covers note bodies (and basenames/headings/tags), so even a content-only edit
            // that's dirty to neither graph nor tree changes search results. When we know exactly which paths
            // changed, patch just those docs in place (re-read one file, not the whole vault); otherwise (an
            // unknown-extent change) drop the index so the next /search rebuilds from current files. The patch
            // is fire-and-forget: a search landing in the brief window before it resolves can return results one
            // edit stale, which self-heals on the next search; on patch failure we fall back to a full drop.
            if (paths.length > 0)
                void updateSearchIndex(cfg.vault, paths).catch(() =>
                    invalidateSearchIndex(cfg.vault),
                )
            else invalidateSearchIndex(cfg.vault)
            // Bases rows feed: patch just the changed notes into the cached Row[] instead of dropping it
            // and re-parsing the whole vault on the next base render (the ~400ms "base loads slowly right
            // after I typed" cost). Unlike the search patch this is AWAITED before the SSE publish below,
            // because a base render persists on screen — a client that refetches /rows on the event must
            // see the patched feed, not a one-edit-stale one. Patching reads only the changed notes (~1ms).
            if (paths.length > 0)
                await patchVaultRows(cfg.vault, paths, rowsCache).catch(() =>
                    rowsCache.invalidate(),
                )
            else rowsCache.invalidate()
            // Tasks feed: same patch-in-place as the rows feed above, for the same reason —
            // a client refetching POST /rows for a tasks-source base after this event must
            // see the patched feed, not a stale one. Awaited before the SSE publish below.
            if (paths.length > 0)
                await patchTaskRows(cfg.vault, paths, tasksCache).catch(() =>
                    tasksCache.invalidate(),
                )
            else tasksCache.invalidate()
        }
        version++
        sse.publish({ version, paths, dirty })
    }

    // Re-fingerprint changed vault notes; report whether the graph and/or tree
    // need to change. New/deleted notes are structural (both dirty); a content-only
    // edit that touches no link, tag, or icon is dirty to neither. Non-note and
    // unreadable (e.g. directory) paths are treated as structural to be safe;
    // hidden paths (.git/.trash) never affect graph or tree and are dropped.
    async function classifyVault(
        paths: string[],
    ): Promise<{ graph: boolean; tree: boolean }> {
        let graph = false
        let tree = false
        const notePaths: string[] = []
        for (const p of paths) {
            // settings.yaml (now under .settings/) is dot-hidden, so it must be matched
            // BEFORE the isWatchIgnored drop below.
            if (isSettingsPath(p)) {
                // settings.yaml drives the property registry + appearance — both graph
                // and tree consumers should refetch; /schema reads it fresh on demand.
                // Also refresh the backend runtime config (debounce, heartbeat, …).
                void loadAppConfig(cfg.vault)
                    .then(c => {
                        appConfig = c
                        // Enabling the daemon for this vault triggers the one-time copy-only migration of
                        // any legacy ~/.claude-bot brain into <vault>/.daemon (machine-marker-gated).
                        if (c.daemon?.enabled) migrateDaemonState(cfg.vault)
                        // The graph/tree dirty flags below invalidate synchronously, but appConfig
                        // reloads async — so re-invalidate the daemon-gated caches AFTER it lands and
                        // nudge clients to refetch, so toggling daemon.enabled/name updates the sidebar
                        // (.daemon visibility + label) and graph (3rd brain) live, without a stale frame.
                        treeCache.invalidate()
                        graphCache.invalidate()
                        // Toggling daemon.enabled flips memory injection for newly-claimed tabs.
                        setPoolMemoryDir(effectiveMemoryDir())
                        version++
                        sse.publish({
                            version,
                            paths: [],
                            dirty: { graph: true, tree: true },
                        })
                    })
                    .catch(() => {})
                graph = true
                tree = true
                continue
            }
            // .daemon/memory is the 3rd brain (feeds the graph) AND shows in the sidebar
            // tree, so a memory-file/subfolder change must dirty both — a new/deleted
            // sub-note or sub-folder is structural to the tree the same way an ordinary
            // vault note is; a content-only rewrite isn't, so an .md path still goes
            // through the tracker below rather than forcing tree=true unconditionally.
            if (isDaemonRuntimeNoise(p)) continue // daemon logs/pids/cron-state → never refetch
            if (isDaemonMemoryPath(p)) {
                graph = true
                if (p.endsWith('.md')) notePaths.push(p)
                else tree = true
                continue
            }
            // .themes/<name>.yaml is dot-hidden but meaningful: it never feeds the graph, but
            // the tree lists `.themes` + its yaml files, so a create/delete/rename must dirty it.
            // The path also rides the SSE `paths` and the app refetches GET /themes itself.
            if (isThemePath(p)) {
                // Only a create/delete is structural; an autosave of an existing file is not.
                if (themeFiles.classify(p, themeFileExists(p))) tree = true
                continue
            }
            if (isSystemFolderPath(p)) {
                tree = true
                continue
            }
            if (isWatchIgnored(p)) continue
            if (!p.endsWith('.md')) {
                graph = true
                tree = true
                continue
            }
            notePaths.push(p)
        }
        const d = await tracker.classify(notePaths, p =>
            readNoteOrNull(cfg.vault, p),
        )
        return { graph: graph || d.graph, tree: tree || d.tree }
    }

    // Single entry point for vault content/structure changes (API mutations +
    // file-watch). With no paths the change extent is unknown, so refresh both.
    async function invalidate(...paths: string[]) {
        const dirty =
            paths.length === 0
                ? { graph: true, tree: true }
                : await classifyVault(paths)
        await applyDirty(paths, dirty)
    }

    /** Schedule vault changes for debounced processing. */
    function scheduleVault(path?: string): void {
        if (path) pendingVault.add(path)
        else pendingVaultUnknown = true
        arm()
    }

    /** Schedule memory changes for debounced processing. */
    function scheduleMemory(): void {
        pendingMemory = true
        arm()
    }

    function arm() {
        // Stamp when this batch started accumulating so flushDelayMs can cap how long the
        // resetting debounce may keep deferring it (see MAX_COALESCE_INTERVALS): without the
        // cap, anything writing faster than the debounce — an agent editing a run of files
        // from a terminal/chat session, a bulk move — re-arms the timer forever and the
        // sidebar/graph never update until the writer stops.
        if (firstPendingAt === 0) firstPendingAt = Date.now()
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(
            () => {
                debounceTimer = null
                firstPendingAt = 0
                const vaultPaths = [...pendingVault]
                const unknown = pendingVaultUnknown
                const memory = pendingMemory
                pendingVault.clear()
                pendingVaultUnknown = false
                pendingMemory = false
                void (async () => {
                    let dirty = { graph: false, tree: false }
                    if (unknown) {
                        dirty = { graph: true, tree: true }
                    } else if (vaultPaths.length) {
                        dirty = await classifyVault(vaultPaths)
                    }
                    // This dedicated memory watcher only ever feeds the graph — it has no
                    // per-path info to classify a tree change from. In production cfg.memory
                    // IS <vault>/.daemon/memory, so the SAME writes also land on the vault
                    // watcher above, which does dirty the tree via classifyVault.
                    if (memory) {
                        dirty.graph = true
                        // Autosave the memory repo so it's revertable + gives the dream cron a commit
                        // history to diff against (refs/bismuth/dream). Coalesced so a burst of memory writes
                        // doesn't spam commits; best-effort, never blocks.
                        if (cfg.memory)
                            scheduleBackup(cfg.memory, () =>
                                snapshotMessage(new Date(), 'memory'),
                            )
                    }
                    // A pure memory-dir batch (no vault paths, extent known) never touched the
                    // vault — skip the cache drops entirely.
                    const vaultTouched = unknown || vaultPaths.length > 0
                    await applyDirty(
                        unknown ? [] : vaultPaths,
                        dirty,
                        vaultTouched,
                    )
                })()
            },
            flushDelayMs(
                Date.now(),
                firstPendingAt,
                appConfig.server.fileWatchDebounceMs,
            ),
        )
    }

    async function readNoteOrEmpty(
        vault: string,
        path: string,
    ): Promise<string> {
        // Single fs op on the hot open path: read directly and treat a missing file
        // as empty. The old exists()+readNote pair did two round-trips (stat then
        // open+read) per GET /file, doubling syscall latency for no benefit — and it
        // had a TOCTOU window between the two. readNoteOrNull swallows ALL read errors, not only ENOENT.
        return (await readNoteOrNull(vault, path)) ?? ''
    }

    // Like readNote, but returns null for a missing file instead of throwing.
    // Distinguishes missing (null) from empty-but-present ("") in a single read,
    // avoiding the TOCTOU of a separate existence check.
    async function readNoteOrNull(
        vault: string,
        path: string,
    ): Promise<string | null> {
        try {
            return await readNote(vault, path)
        } catch {
            return null
        }
    }

    // --- Owner-token gate (closes the unauthenticated HTTP content oracle — see ownerToken.ts) ---
    // Minted fresh per boot, held only in memory + this vault's 0600 run record. A request
    // presenting it via X-Bismuth-Token is the vault's OWN app/CLI — every content route below
    // stays unfiltered for it, exactly as before this gate existed. Every other request is treated
    // as an agent acting on the owner's behalf (chat or daemon, defaulting to the stricter daemon)
    // and gets the SAME visibility filter that already gates Claude's own tools, so the HTTP API
    // can never see more than the tool-level gate does.
    //
    // BISMUTH_OWNER_TOKEN lets WHOEVER SPAWNED this process supply the value instead of us minting
    // our own — required so that spawner can also hand the SAME value to the frontend it's about
    // to point at us: the Tauri shell (app/src-tauri/src/lib.rs's start_backend, which injects
    // window.__BISMUTH_OWNER_TOKEN__) and the dev script (app/scripts/dev.ts, which sets
    // VITE_OWNER_TOKEN for the same value). Without this override, core would mint its OWN random
    // token that neither of those could ever guess, and the app's own requests would be
    // (indistinguishable from an agent's and therefore) filtered. Absent (bare `bun run
    // core/src/server.ts`, `bismuth serve`, tests) → mint fresh, exactly as before.
    const ownerToken = process.env.BISMUTH_OWNER_TOKEN || mintOwnerToken()

    function requestChannel(req: Request): RequestChannel {
        return resolveRequestChannel(req.headers, ownerToken)
    }

    // The restricted-path list for a request's channel — [] for the owner (never filtered) or for
    // an unrestricted vault (buildDenyPaths itself returns [] when nothing is marked). Memoized
    // PER VAULT VERSION (see `version`, bumped by the file watcher below): on the audited real
    // vault, buildDenyPaths costs 114ms warm / 219ms cold and — with nothing hidden — walks the
    // whole vault to discover exactly zero restricted entries, on every non-owner HTTP request AND
    // every chat turn. `visibility.ts` stays deliberately uncached (its other callers — the daemon,
    // the CLI, the MCP tools — are separate, short-lived, or minutes apart, so a per-call walk there
    // is fine); the memo belongs here instead, where the invalidation signal already lives: a
    // visibility edit writes `.settings`/frontmatter, the watcher classifies it, and `version` bumps
    // (see the `version++` sites below) — so dropping the ENTIRE memo whenever the current version
    // no longer matches the memo's stamped version reproduces the "next request sees the edit"
    // contract exactly, just without re-walking on every OTHER request in between.
    //
    // The owner's requests short-circuit above this and never touch the memo at all. In-flight
    // walks are memoized too (by promise, not just resolved value), so N concurrent non-owner
    // requests during the same version share ONE walk instead of each starting their own. A
    // rejected walk is evicted immediately rather than cached: fail-safe means the next request
    // gets a fresh attempt (and, via the route dispatch's catch-all, a 500 — never a fallback to a
    // permissive `[]`), not a walk permanently wedged in a failed state until the next edit.
    let denyPathsMemoVersion = -1
    let denyPathsMemo = new Map<VisibilityChannel, Promise<DenyEntry[]>>()

    async function denyEntriesForRequest(req: Request): Promise<DenyEntry[]> {
        const channel = requestChannel(req)
        if (channel === 'owner') return []

        if (denyPathsMemoVersion !== version) {
            denyPathsMemo = new Map()
            denyPathsMemoVersion = version
        }

        const cached = denyPathsMemo.get(channel)
        if (cached) return cached

        const walk: Promise<DenyEntry[]> = buildDenyPaths(
            cfg.vault,
            channel,
        ).catch(err => {
            if (denyPathsMemo.get(channel) === walk)
                denyPathsMemo.delete(channel)
            throw err
        })
        denyPathsMemo.set(channel, walk)
        return walk
    }

    // Retained so stop() can close them: like gcalTicker below, a watcher outlives the server that
    // made it. `bun test core` builds hundreds of servers in one process, and every leaked recursive
    // watch slows the FSEvents stream setup of every later one.
    const watchers: LiveWatcher[] = []
    // watchLive, not a bare fs.watch: a change made while the watch is still starting (this server's
    // own boot writes, an agent editing as the app launches) is otherwise never reported.
    try {
        watchers.push(
            watchLive(
                cfg.vault,
                filename => {
                    // Ignore churn in .git (backup commits), .trash, and the daemon's DAEMON.md status
                    // heartbeat — none feed the graph or tree. A null filename means "something changed,
                    // extent unknown". System folders (.settings/.daemon) are dot-hidden but meaningful,
                    // so they bypass the hidden-drop (classifyVault routes them to tree/graph).
                    if (filename && isDaemonRuntimeNoise(filename)) return // drop daemon runtime churn early
                    if (
                        filename &&
                        !isSystemFolderPath(filename) &&
                        !isSettingsPath(filename) &&
                        !isThemePath(filename) &&
                        isWatchIgnored(filename)
                    )
                        return
                    // The API is (or just was) writing this exact path itself (see
                    // mutatingHandler/markSelfWritten) — this is that write's own echo, not a new
                    // external change. See consumeSelfWritten for why only the first echo is swallowed,
                    // and unmarkSelfWritten for why a failed mutation — thrown OR returned as a >=400
                    // response — can't leave a false positive here.
                    if (filename && consumeSelfWritten(filename)) return
                    scheduleVault(filename ?? undefined)
                },
                { skipDir: skipWatchWalk },
            ),
        )
    } catch {
        // vault dir may not exist in test / CI environments
    }
    if (cfg.memory) {
        try {
            watchers.push(
                watchLive(
                    cfg.memory,
                    filename => {
                        // Ignore .git churn from our own memory autosave commits (mirrors the vault watch).
                        if (filename && isHidden(filename)) return
                        scheduleMemory()
                    },
                    { skipDir: isHidden },
                ),
            )
        } catch {
            // memory dir may be absent
        }
    }

    const ctx: RouteContext = {
        cfg,
        get appConfig() {
            return appConfig
        },
        get version() {
            return version
        },
        set appConfig(next) {
            appConfig = next
        },
        get server() {
            return server
        },
        get taskMigration() {
            return taskMigration
        },
        sse,
        graphCache,
        treeCache,
        rowsCache,
        tasksCache,
        bootReconcile,
        statusRunner,
        statusItems,
        invalidate,
        markSelfWritten,
        rearmSelfWritten,
        unmarkSelfWritten,
        readNoteOrEmpty,
        readNoteOrNull,
        requestChannel,
        denyEntriesForRequest,
        mutatingHandler,
    }
    const routes: Record<string, Handler> = {
        ...agentsRoutes(ctx),
        ...basesRoutes(ctx),
        ...daemonRoutes(ctx),
        ...gcalRoutes(ctx),
        ...graphRoutes(ctx),
        ...relayRoutes(ctx),
        ...settingsRoutes(ctx),
        ...systemRoutes(ctx),
        ...tasksRoutes(ctx),
        ...vaultRoutes(ctx),
    }
    const mutatingRoutes: Record<string, Handler> = {
        ...basesMutatingRoutes(ctx),
        ...daemonMutatingRoutes(ctx),
        ...gcalMutatingRoutes(ctx),
        ...settingsMutatingRoutes(ctx),
        ...tasksMutatingRoutes(ctx),
        ...vaultMutatingRoutes(ctx),
    }

    function mutatingHandler(
        run: (req: Request, url: URL) => Promise<Response> | Response,
        pathOf?: (body: any) => string | string[] | undefined,
    ): Handler {
        return async (req, url) => {
            // Tee the body so we can both read it for path extraction and pass it to run.
            const cloned = req.clone()
            let paths: string[] = []
            if (pathOf) {
                try {
                    const body = await cloned.json()
                    const p = pathOf(body)
                    if (typeof p === 'string') paths = [p]
                    else if (Array.isArray(p)) paths = p
                } catch {
                    // body wasn't JSON — that's fine, we just won't know the path
                }
            }
            // Mark BEFORE run() performs the actual write, closing the race where the OS
            // watcher could notice the write before we've recorded it as self-written. This
            // means the mark is made on INTENT, not on confirmed success — run() can still
            // reject (EEXIST, a 404 on a stale path, ordinary validation failures, not just
            // exotic ones) with nothing written at all, so both failure shapes must take the
            // mark back off before returning: a throw (unmarkSelfWritten in the catch) AND a
            // route that returns an error Response directly instead of throwing (the status
            // check below) — several mutating routes do the latter on their everyday failure
            // paths (a 404 on set-property/delete-property, a 400 on set-setting, and others),
            // and run() resolves normally for those, so the catch alone would miss them.
            markSelfWritten(paths)
            let res: Response
            try {
                res = await run(req, url)
            } catch (e) {
                unmarkSelfWritten(paths)
                throw e
            }
            // Same reasoning as the catch above, for the non-throwing failure shape: nothing
            // was written (or shouldn't be trusted to have been), so the mark comes back off.
            // Fail-safe in the direction that matters — if a route ever returns >=400 after a
            // write genuinely landed, unmarking only costs one redundant invalidation wave (the
            // pre-existing, pre-Task-5 behaviour), never a lost external change.
            //
            // Otherwise (a genuine write): RE-arm now that run() has actually resolved, rather
            // than trusting the mark() made before it — some routes (a /move whose destination
            // takes a while to settle, e.g. a large tree) take longer than the debounce to
            // finish, and the original mark would already have expired by the time the watcher
            // notices the write, letting the echo through as a second, spurious invalidation.
            // NOTE: only extends paths STILL marked — see selfWriteMarks.ts's rearm() for why a
            // batch write (several paths marked together) must not resurrect one the watcher
            // already consumed while a LATER path in the same batch was still being written.
            if (res.status >= 400) unmarkSelfWritten(paths)
            else rearmSelfWritten(paths)
            await invalidate(...paths)
            return res
        }
    }

    // Warm the graph + tree caches off the critical path so the first webview request
    // finds them ready (or already building, and deduped) instead of paying the build
    // serially after launch. Errors are swallowed (e.g. vault dir absent in tests).
    graphCache.warm()
    treeCache.warm()

    // Fire-and-forget, like every other boot-time pass: start the task-syntax migration scan
    // once the tree build has settled (treeCache.warm() already kicked it off above — this
    // .get() dedupes onto it, per asyncCache's in-flight sharing), instead of firing it
    // immediately alongside reconcileSettings/registerVaultRoot. It walks + reads every
    // markdown file in the vault, and running that in the same breath as the graph/tree builds
    // stole CPU from both on a large vault. onScanned seeds the change tracker with each
    // scanned note's fingerprint (whether or not that note needed migrating), so a note's FIRST
    // save after boot can be classified content-only instead of forced structural — see
    // changeClassifier.ts's seed(). Independent of, and does not reorder, the graph→tree+rows+
    // tasks→view-layouts chain immediately below (both simply await the same treeCache).
    if (skipTaskMigrate) {
        // Wave 3 review (M2): report a FINISHED no-op immediately, not `ran: null` forever —
        // `null` means "hasn't finished yet" (see GET /tasks/migration's comment), and the app's
        // poll (app/src/migrationPoll.ts) would otherwise retry for its whole backoff budget
        // waiting on a result that will never arrive.
        taskMigration = emptyMigrationReport()
    } else {
        void treeCache
            .get()
            .catch(() => {})
            .then(() =>
                runTaskMigration(cfg.vault, {
                    onScanned: (rel, text) => tracker.seed(rel, text),
                }),
            )
            .then(r => {
                taskMigration = r
            })
            .catch(() => {})
    }

    // Once the graph is ready, warm tree (already building above — .get() dedupes onto it)
    // alongside the bases rows + tasks feeds, so the first base render doesn't pay the ~400ms
    // cold vault walk (the "first base loads slowly" cost) and the sidebar isn't left waiting
    // behind view-layout CPU. ONLY THEN compute the 2nd/3rd-brain view layouts and attach them to
    // the cached graph object in place (exactly as GET /graph/views does) — this is unrequested
    // work (nothing has asked for a brain-mode switch yet), and its force-sim CPU previously ran
    // right after the graph, on the single JS thread, ahead of — and delaying — /tree and the
    // feeds. Moving it last means the first brain-mode switch still finds it precomputed (instant
    // instead of a cold subgraph layout on click); it just no longer starves everything else on
    // the boot critical path to get there. Being unrequested, it is also `speculative` and carries a
    // controller of its own per pass (viewWarmup): a graph invalidation while it runs cancels it — even mid
    // full settle — so it never holds the layout worker ahead of the rebuild a real edit needs, and the next
    // pass runs on the rebuilt graph. After boot it keeps going: see warmViews below.

    // Keeps the 2nd/3rd-brain view layouts warm for the graph as it is NOW: one pass after boot, then one
    // more after every graph invalidation (a structural edit, a daemon memory write). Before this, views
    // were computed once at boot and any later structural edit dropped them, so the next brain-mode switch
    // paid a cold subgraph layout — and an edit landing DURING the boot pass aborted it for good. A pass is
    // speculative, so it never holds the layout worker ahead of a requested rebuild; a burst of edits
    // costs one aborted pass per invalidation and one completed pass once the graph settles.
    const warmViews = async (): Promise<void> => {
        while (!stopped) {
            // Armed BEFORE reading the graph, so an invalidation during the read or the pass is never lost.
            const invalidated = new Promise<void>(r => (wakeViewWarmup = r))
            const g = await graphCache.get().catch(() => null)
            if (stopped) return
            if (g) {
                const warmup = new AbortController()
                viewWarmup = warmup
                try {
                    g.views = await computeViewLayouts(g, cfg.vault, {
                        signal: warmup.signal,
                        speculative: true,
                    })
                } catch {
                    // Aborted by an invalidation (the next pass picks it up) or a failed layout (retried
                    // on the next invalidation rather than spun on) — either way, wait below.
                } finally {
                    if (viewWarmup === warmup) viewWarmup = null
                }
            }
            await invalidated
        }
    }

    void graphCache
        .get()
        .then(() =>
            Promise.allSettled([
                treeCache.get(),
                rowsCache.get(),
                tasksCache.get(),
            ]),
        )
        .then(() => warmViews())
        .catch(() => {})

    // The WS payload is discriminated by `kind`: terminal sockets pipe a PTY, chat sockets
    // drive the headless Claude Code chat driver (core/src/chat.ts).
    type TermWsData = {
        kind: 'terminal'
        sessionId: string
        dataSub?: { dispose(): void }
        exitSub?: { dispose(): void }
    }
    // `sink` is the ONE frame-sender for this socket's whole lifetime, bound in `open` and reused by
    // every `message` (not a fresh closure per message) so it has a stable identity `close` can hand
    // to chatDetachSink for its identity guard (a stale close from an OLD socket, arriving after a
    // reconnect already rebound the session to a NEWER sink, must not re-detach a live session — see
    // sessionSink.ts's detachSessionSink).
    type ChatWsData = {
        kind: 'chat'
        chatId: string
        rebind: boolean
        sink?: (frame: unknown) => void
    }
    // The per-window control socket (core/src/uiControl.ts). `send` is the JSON-frame sender bound in
    // `open`, kept so `close` can identity-guard unregister (a stale close must not drop a reconnected
    // window that already re-registered under the same windowId).
    type UiWsData = {
        kind: 'ui'
        windowId: string
        send?: (frame: unknown) => void
    }
    type WsData = TermWsData | ChatWsData | UiWsData
    const server = Bun.serve<WsData>({
        port: cfg.port ?? 4321,
        // Bun's default idleTimeout is 10s, which would drop a connection mid-request for the
        // few slow handlers we have (notably long export/GCal-sync requests). 255s is Bun's
        // max; long enough for those, harmless for everything else.
        idleTimeout: 255,
        async fetch(req, server) {
            const url = new URL(req.url)
            if (req.method === 'OPTIONS') return withCors(new Response(null))

            // Terminal WebSocket upgrade.
            if (req.method === 'GET' && url.pathname === '/terminal') {
                const cols = Number(url.searchParams.get('cols'))
                const rows = Number(url.searchParams.get('rows'))
                if (
                    !Number.isInteger(cols) ||
                    !Number.isInteger(rows) ||
                    cols < 1 ||
                    cols > 500 ||
                    rows < 1 ||
                    rows > 500
                ) {
                    return withCors(error('bad cols/rows', 400))
                }
                const origin = req.headers.get('origin')
                // Allow:
                // - same-origin (no Origin header, e.g. Tauri webview)
                // - localhost/127.0.0.1 on any port (Vite dev server, the Tauri webview, browser-based local dev)
                // - tauri://localhost (Tauri scheme on some platforms)
                const allowed =
                    !origin ||
                    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
                        origin,
                    ) ||
                    /^tauri:\/\//.test(origin) ||
                    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)
                if (!allowed) {
                    return withCors(error('forbidden origin', 403))
                }
                // Reattach: a reconnecting/reloading client passes its stable term id. If
                // its PTY is still alive (within the post-disconnect grace window), pipe to
                // the SAME shell — preserving the running process, cwd, and env — instead of
                // silently spawning a fresh one. Otherwise create a new session keyed by it.
                const termId = url.searchParams.get('termId') ?? undefined
                const existing = termId ? getSessionByTermId(termId) : undefined
                let createdNew = false
                let session
                if (existing) {
                    cancelSessionKill(existing.id) // we're reattaching — don't kill it
                    resizeSession(existing.id, cols, rows)
                    session = existing
                } else {
                    // Prefer a pre-warmed shell from the pool: its prompt is already rendered, so
                    // the tab paints instantly instead of waiting on a cold login-shell rc load.
                    // Falls back to a fresh spawn when the pool is empty. Tabs report to THIS
                    // server's port so the in-tab Claude sessions' relay hooks reach the right
                    // core (multiple windows = multiple backends).
                    session =
                        claimPooledSession({ termId, cols, rows }) ??
                        createTerminalSession({
                            cwd: cfg.vault,
                            cols,
                            rows,
                            relayPort: server.port,
                            termId,
                            memoryDir: effectiveMemoryDir(),
                        })
                    createdNew = true
                }
                const upgraded = server.upgrade(req, {
                    data: {
                        kind: 'terminal',
                        sessionId: session.id,
                    } as TermWsData,
                })
                if (!upgraded) {
                    // Never hard-kill a reattached live shell on a failed upgrade; just let its
                    // grace timer reclaim it if no socket reconnects.
                    if (createdNew) killSession(session.id)
                    else scheduleSessionKill(session.id, reattachGraceMs())
                    return withCors(error('upgrade failed', 400))
                }
                return new Response(null, { status: 101 }) // upgrade response is sent by Bun
            }

            // Chat WebSocket upgrade — drives the headless Claude Code chat driver. Same origin
            // allow-list as /terminal. Read-path (not a vault mutation): the client may pass a
            // stable `chatId` to resume conversation continuity across reconnects; otherwise one
            // is generated.
            if (req.method === 'GET' && url.pathname === '/chat') {
                const origin = req.headers.get('origin')
                const allowed =
                    !origin ||
                    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
                        origin,
                    ) ||
                    /^tauri:\/\//.test(origin) ||
                    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)
                if (!allowed) {
                    return withCors(error('forbidden origin', 403))
                }
                const chatId = url.searchParams.get('chatId') || newChatId()
                // `rebind=1` marks a RECONNECT (the client had this chat open and lost the socket) as
                // opposed to a first open — it lets the open handler tell the client when the session
                // it expects is already gone (grace window expired) instead of silently starting fresh.
                const rebind = url.searchParams.get('rebind') === '1'
                const upgraded = server.upgrade(req, {
                    data: { kind: 'chat', chatId, rebind } as ChatWsData,
                })
                if (!upgraded) return withCors(error('upgrade failed', 400))
                return new Response(null, { status: 101 })
            }

            // UI-control WebSocket — the core→frontend command channel (core/src/uiControl.ts). Same
            // origin allow-list as /terminal + /chat. `?w=<id>` is the window's stable id (windowId.ts);
            // absent → "main" (the primary window). Registered on open, keyed by that id.
            if (req.method === 'GET' && url.pathname === '/ui') {
                const origin = req.headers.get('origin')
                const allowed =
                    !origin ||
                    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
                        origin,
                    ) ||
                    /^tauri:\/\//.test(origin) ||
                    /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)
                if (!allowed) return withCors(error('forbidden origin', 403))
                const windowId = url.searchParams.get('w') || 'main'
                const upgraded = server.upgrade(req, {
                    data: { kind: 'ui', windowId } as UiWsData,
                })
                if (!upgraded) return withCors(error('upgrade failed', 400))
                return new Response(null, { status: 101 })
            }

            const route = `${req.method} ${url.pathname}`
            const handler = routes[route] ?? mutatingRoutes[route]

            if (!handler) {
                return withCors(error('not found', 404))
            }

            try {
                const res = await handler(req, url, cfg)
                return withCors(res)
            } catch (e) {
                const err =
                    e instanceof AppError
                        ? e
                        : new AppError(
                              'INTERNAL_ERROR',
                              (e as Error).message,
                              500,
                          )
                return withCors(error(err.message, err.statusCode))
            }
        },

        websocket: {
            open(ws) {
                if (ws.data.kind === 'ui') {
                    // Register this window's control socket. `send` pushes JSON command frames; it's stashed on
                    // ws.data so `close` can identity-guard the unregister.
                    const send = (frame: unknown) => {
                        try {
                            ws.send(JSON.stringify(frame))
                        } catch {
                            /* socket closed */
                        }
                    }
                    ws.data.send = send
                    registerWindow(ws.data.windowId, send)
                    return
                }
                if (ws.data.kind === 'chat') {
                    // A reconnect (same chatId) mid-turn: re-point the live session's sink at THIS new socket
                    // and cancel its grace-period teardown, so in-flight drain frames (incl. the turn's tail
                    // and `done`) flow here instead of the dead socket — rebindSink also flushes any frames
                    // buffered while detached. A brand-new chat has no session yet — rebind is a no-op and
                    // the first {type:"user"} binds the sink via sendMessage. The sink closure is created ONCE
                    // here and stashed on ws.data (see ChatWsData's own comment) — every `message` below reuses
                    // it, and `close` hands it back to chatDetachSink for the identity guard.
                    const { chatId, rebind } = ws.data
                    const sink = (frame: unknown) => {
                        try {
                            ws.send(JSON.stringify(frame))
                        } catch {
                            /* socket closed mid-turn */
                        }
                    }
                    ws.data.sink = sink
                    const rebound = chatRebindSink(chatId, sink)
                    // The client RECONNECTED expecting its session, but the 30s grace already tore it down
                    // (closeChat sends no frame) — tell it explicitly so a wedged mid-turn UI clears and the
                    // user learns the conversation ended, instead of the next send silently starting fresh.
                    if (!rebound && rebind) {
                        const frame = {
                            type: 'error',
                            code: 'exit',
                            message:
                                'The Claude Code session ended while disconnected — send a message to start a new one.',
                        }
                        try {
                            ws.send(JSON.stringify(frame))
                        } catch {
                            /* */
                        }
                    }
                    return
                }
                const data = ws.data
                const s = getSession(data.sessionId)
                if (!s) {
                    ws.close()
                    return
                }
                // Pipe PTY -> ws via the session's switchable sink. attachSink first flushes any
                // buffered output (a pre-warmed pool prompt, or output produced during a brief
                // disconnect) so the prompt shows immediately, then streams live bytes.
                attachSink(s.id, (d: string) => {
                    ws.send(enc.encode(d))
                })
                // Shell exited: close with code 1000 so the client treats it as a real exit
                // (close the tab) rather than a dropped connection to reconnect/reattach.
                data.exitSub = s.pty.onExit(() => {
                    try {
                        ws.close(1000, 'exited')
                    } catch {
                        /* */
                    }
                })
            },
            message(ws, msg) {
                if (ws.data.kind === 'ui') {
                    // Two client→core frames on the control socket:
                    //   {type:"tabs", snapshot}                 → the tab-layout heartbeat (powers /ui/windows)
                    //   {type:"reply", reqId, ok, result, error} → answer to a command core sent
                    const text =
                        msg instanceof ArrayBuffer || msg instanceof Uint8Array
                            ? dec.decode(msg)
                            : (msg as string)
                    let parsed: {
                        type?: string
                        snapshot?: UiTabsSnapshot
                        reqId?: string
                        ok?: boolean
                        result?: unknown
                        error?: string
                    }
                    try {
                        parsed = JSON.parse(text)
                    } catch {
                        return
                    }
                    if (parsed.type === 'tabs' && parsed.snapshot) {
                        updateTabs(ws.data.windowId, parsed.snapshot)
                    } else if (
                        parsed.type === 'reply' &&
                        typeof parsed.reqId === 'string'
                    ) {
                        resolveReply(parsed.reqId, {
                            ok: parsed.ok === true,
                            result: parsed.result,
                            error:
                                typeof parsed.error === 'string'
                                    ? parsed.error
                                    : undefined,
                        })
                    }
                    return
                }
                if (ws.data.kind === 'chat') {
                    // Chat protocol is text JSON, driving the visual Claude Code session (core/src/chat.ts):
                    //   {type:"open"}                                   → spawn the session eagerly (no turn) so
                    //                                                     the header's manifest + models frame land
                    //                                                     before the first message (BUG #14)
                    //   {type:"user",text,images?}                      → run a turn (slash commands are just text;
                    //                                                     images = base64 blocks the user attached)
                    //   {type:"resume",sessionId}                       → bind this chat to an existing session
                    //   {type:"permission_response",id,behavior,always?} → answer a "permission" frame
                    //   {type:"question_response",id,answers?,cancelled?} → answer an AskUserQuestion "question"
                    //   {type:"set_permission_mode",mode}               → switch permission mode live
                    //   {type:"set_model",model}                        → switch model live
                    //   {type:"stop"}                                   → interrupt the in-flight turn
                    // ChatFrames stream back via the sink. `open`/`user`/`resume` may carry `provider`
                    // ("claude" | "opencode") — resolved against the vault's chat.provider default and
                    // routed by core/src/chatProviders; a chatId with a live session stays on its backend.
                    const { chatId } = ws.data
                    const text =
                        msg instanceof ArrayBuffer || msg instanceof Uint8Array
                            ? dec.decode(msg)
                            : (msg as string)
                    let parsed: {
                        type?: string
                        text?: string
                        images?: { media_type?: unknown; data?: unknown }[]
                        sessionId?: string
                        id?: string
                        behavior?: 'allow' | 'deny'
                        always?: boolean
                        mode?: string
                        model?: string
                        effort?: string
                        answers?: Record<string, unknown>
                        cancelled?: boolean
                        provider?: string
                    }
                    try {
                        parsed = JSON.parse(text)
                    } catch {
                        return
                    }
                    // The SAME closure `open` bound to ws.data.sink — reused, not re-created, so its identity
                    // stays stable for the whole socket's lifetime (see ChatWsData's comment + `close` below).
                    // Always defined: `open` fires before any `message` for a given socket.
                    const chatSink = ws.data.sink!
                    const provider = resolveBackendId(
                        parsed.provider,
                        (appConfig.chat as Record<string, unknown> | undefined)
                            ?.provider,
                        installedBackendIds,
                    )
                    if (parsed.type === 'open') {
                        // Chat OPEN (the ChatView just mounted / reconnected on a fresh id): spawn the session
                        // eagerly so its `init` manifest + `models` frame + permission mode stream to the header
                        // BEFORE the first message (BUG #14). No-op if a session already exists for this chatId
                        // (a mid-turn reconnect already rebound the sink on WS open) — never spawns a duplicate.
                        chatOpen(
                            chatId,
                            cfg.vault,
                            chatSink,
                            effectiveMemoryDir(),
                            provider,
                        )
                    } else if (
                        parsed.type === 'user' &&
                        typeof parsed.text === 'string'
                    ) {
                        // Accept optional base64 image attachments; keep only well-formed {media_type,data}
                        // pairs whose media_type is an SDK-accepted image MIME (the frontend whitelist is not the
                        // only client — a rogue local client could send anything), so a malformed or
                        // unsupported attachment can never reach makeUserMessage / the SDK image block.
                        const images = Array.isArray(parsed.images)
                            ? parsed.images.filter(
                                  (
                                      im,
                                  ): im is {
                                      media_type: string
                                      data: string
                                  } =>
                                      !!im &&
                                      typeof im === 'object' &&
                                      typeof (im as { media_type?: unknown })
                                          .media_type === 'string' &&
                                      [
                                          'image/png',
                                          'image/jpeg',
                                          'image/gif',
                                          'image/webp',
                                      ].includes(
                                          (im as { media_type: string })
                                              .media_type,
                                      ) &&
                                      typeof (im as { data?: unknown }).data ===
                                          'string' &&
                                      (im as { data: string }).data.length > 0,
                              )
                            : []
                        chatSend(
                            chatId,
                            parsed.text,
                            cfg.vault,
                            chatSink,
                            images.length ? images : undefined,
                            effectiveMemoryDir(),
                            provider,
                        )
                    } else if (
                        parsed.type === 'resume' &&
                        typeof parsed.sessionId === 'string'
                    ) {
                        // Bind this chat socket to an existing session (Claude Code or opencode, per
                        // `provider`) — its init manifest streams back, and the next {type:"user"} continues
                        // the resumed conversation.
                        chatResume(
                            chatId,
                            parsed.sessionId,
                            cfg.vault,
                            chatSink,
                            effectiveMemoryDir(),
                            provider,
                        )
                    } else if (
                        parsed.type === 'permission_response' &&
                        typeof parsed.id === 'string' &&
                        (parsed.behavior === 'allow' ||
                            parsed.behavior === 'deny')
                    ) {
                        chatRespondPermission(
                            chatId,
                            parsed.id,
                            parsed.behavior,
                            parsed.always === true,
                        )
                    } else if (
                        parsed.type === 'question_response' &&
                        typeof parsed.id === 'string'
                    ) {
                        // Answer an AskUserQuestion "question" frame. `cancelled` (or no answers) skips it; an
                        // `answers` object maps each question's TEXT → the chosen answer string. A rogue client
                        // isn't the only caller, so keep ONLY string→string entries before forwarding to the SDK.
                        let answers: Record<string, string> | null = null
                        if (
                            !parsed.cancelled &&
                            parsed.answers &&
                            typeof parsed.answers === 'object'
                        ) {
                            const clean: Record<string, string> = {}
                            for (const [k, v] of Object.entries(
                                parsed.answers,
                            )) {
                                if (typeof v === 'string') clean[k] = v
                            }
                            if (Object.keys(clean).length) answers = clean
                        }
                        chatRespondQuestion(chatId, parsed.id, answers)
                    } else if (
                        parsed.type === 'set_permission_mode' &&
                        typeof parsed.mode === 'string'
                    ) {
                        chatSetPermissionMode(chatId, parsed.mode)
                    } else if (
                        parsed.type === 'set_model' &&
                        typeof parsed.model === 'string'
                    ) {
                        chatSetModel(chatId, parsed.model)
                    } else if (
                        parsed.type === 'set_effort' &&
                        typeof parsed.effort === 'string'
                    ) {
                        // Switch the reasoning-effort level live (FEATURE #63) — mirrors set_model.
                        chatSetEffort(chatId, parsed.effort)
                    } else if (parsed.type === 'stop') {
                        chatAbort(chatId)
                    }
                    return
                }
                const { sessionId } = ws.data
                const s = getSession(sessionId)
                if (!s) return
                const bytes =
                    msg instanceof ArrayBuffer
                        ? new Uint8Array(msg)
                        : msg instanceof Uint8Array
                          ? msg
                          : enc.encode(msg as string)
                if (bytes.length === 0) return
                const tag = bytes[0]
                if (tag === 0x00) {
                    s.pty.write(dec.decode(bytes.subarray(1)))
                } else if (tag === 0x01 && bytes.length >= 5) {
                    const view = new DataView(
                        bytes.buffer,
                        bytes.byteOffset + 1,
                        4,
                    )
                    const cols = view.getUint16(0, true)
                    const rows = view.getUint16(2, true)
                    resizeSession(sessionId, cols, rows)
                }
            },
            close(ws, code) {
                if (ws.data.kind === 'ui') {
                    // Identity-guarded (uiControl.ts): a stale close after a reconnect re-registered a new
                    // socket under this windowId is a no-op, so the live window isn't dropped.
                    unregisterWindow(ws.data.windowId, ws.data.send)
                    return
                }
                if (ws.data.kind === 'chat') {
                    // A CLEAN close (1000) is an intentional tab-close → tear the session down now. An
                    // ABNORMAL close (reload 1001, network drop 1006) → detach the sink (frames buffer for
                    // the reconnect's rebindSink flush instead of vanishing into the dead socket) and keep
                    // the session alive for a short grace window so a reconnect (the client retries with
                    // the same chatId) resumes the same conversation instead of spawning a fresh one. The next
                    // sendMessage/rebind cancels the timer. IDENTITY-GUARDED (ws.data.sink, same as
                    // uiControl.ts's unregisterWindow): on a half-open drop (lid close, wifi loss, NAT
                    // timeout) the client can already have reconnected with a NEW socket — whose `open`
                    // rebound the session to a NEWER sink — before THIS stale socket's close event lands
                    // (the common case, not an edge one: ChatView's own reconnect fires off the client's
                    // `onclose` within seconds, while this server has no `idleTimeout` set on the WS upgrade,
                    // so the OLD half-open socket's close can lag well behind). chatDetachSink returns whether
                    // it actually detached (false on a rejected guard) — the teardown timer below is armed
                    // ONLY then: arming it unconditionally would kill a session that's live and actively
                    // watched under the new sink 30s later, sending no frame, even though the guard just
                    // correctly left it alone. A rejected guard leaks nothing: the newer socket's OWN close
                    // will arm its own timer when it eventually happens, and a since-vanished session makes
                    // scheduleClose a no-op regardless. ws.data.sink is only TYPED optional because it's
                    // assigned after construction (see ChatWsData's comment) — always actually set by `open`
                    // before any `close` can fire. Read once into a local rather than asserted with `!` at the
                    // call site: an assertion would silently fail OPEN (skip the detach AND the teardown) on a
                    // hypothetically-undefined sink, exactly inverting the old unguarded code's fail-SAFE
                    // behavior (detach unconditionally). `!sink` here instead falls back to the same
                    // always-schedule behavior, never silently orphaning a session with no teardown path.
                    const sink = ws.data.sink
                    if (code === 1000) {
                        closeChat(ws.data.chatId)
                    } else if (!sink || chatDetachSink(ws.data.chatId, sink)) {
                        scheduleChatClose(ws.data.chatId, chatGraceMs())
                    }
                    return
                }
                const data = ws.data
                // Detach the live sink (no ws.send on a closed socket) — output resumes buffering
                // for a possible reattach — and drop the exit listener.
                detachSink(data.sessionId)
                data.exitSub?.dispose()
                // A CLEAN close (code 1000) means either the shell process exited (server-side
                // ws.close after pty.onExit) or the client intentionally disposed the tab
                // (ws.close(1000)). Kill the PTY now. An ABNORMAL close (reload → 1001, network
                // drop → 1006, etc.) keeps the PTY alive for a grace window so the reconnecting
                // client can reattach by termId and keep its running process.
                if (code === 1000) killSession(data.sessionId)
                else scheduleSessionKill(data.sessionId, reattachGraceMs())
            },
        },
    })

    // Drop this core's discovery record (~/.bismuth/run/<vault>.json = {port, vault, pid, token}) now
    // that Bun.serve has bound its (possibly dynamic) port, so an out-of-app caller — the `bismuth
    // app …` CLI, the launchd daemon — can find which port serves this vault, AND (new) this boot's
    // owner token, giving a future owner-side CLI caller a path to read it and present it (nothing
    // in THIS change makes the `bismuth` CLI itself do so yet — see the integrator note in
    // ownerToken.ts; until it does, a bare `bismuth api …` is treated as a non-owner "daemon"-channel
    // request, same as any other tokenless caller).
    // Best-effort; cleaned up on exit. Written 0600 (runRegistry.ts) since it now carries a secret.
    if (typeof server.port === 'number') {
        writeRunRecord({
            port: server.port,
            vault: cfg.vault,
            pid: process.pid,
            token: ownerToken,
        })
    }

    // Sweep last session's leftovers out of the chat scratch dir (~/.bismuth/tmp — files staged
    // by POST /tmp-file so a pasted chat attachment has a readable path). Staging only happens on
    // a user gesture, so there is nothing to justify a background timer; pruning what the previous
    // run left behind is the behaviour that matters. Best-effort — a fire-and-forget promise so a
    // slow/unreadable scratch dir never delays boot.
    void pruneTmpFiles().catch(() => {})

    // Pre-warm one login shell so the first terminal tab paints its prompt instantly
    // (cwd = vault, reporting to this server's port). Guarded so a spawn failure here can
    // never take the server down — terminals still cold-spawn on demand.
    try {
        prewarmPool(cfg.vault, server.port, effectiveMemoryDir())
    } catch {
        /* pre-warm is best-effort */
    }

    // Background Google Calendar auto-sync (PER-CALENDAR): every `syncIntervalMinutes`, when an
    // account is connected, reconcile EVERY calendar base that has Google sync enabled — each
    // against its OWN Google calendar (resolved from that base's frontmatter, with the legacy
    // global mapping as a migration fallback). Each base-file write is picked up by the vault
    // watcher (cache-invalidate + SSE) so the open calendar refreshes. Best-effort +
    // error-tolerant; the ticker is unref'd so it never keeps the process alive, and is a
    // no-op until an account is connected (fresh test vaults never are). A run-guard prevents overlap.
    //
    // The handle is retained so stop() can clear it (see below). It has to be: this interval is
    // created fresh by every `createServer()` call, and Bun.serve()'s own `.stop()` closes the HTTP
    // listener only — it has no idea this interval exists. An uncleared ticker outlives the server
    // that made it and keeps firing for the remaining life of the PROCESS, against the vault that
    // server was given. `.unref()` does not bound that: unref only lets the process exit once
    // nothing else is pending, and says nothing about a process that stays alive for other reasons.
    // Concretely, `bun test core` runs every test file in one process, so a stopped server's ticker
    // fires during a LATER file and scans a vault path that only ever existed as an earlier file's
    // fixture — an ENOENT with no connection to whatever test is running when it lands.
    // Auto-sync writes to the user's REAL Google Calendar (Phase C of sync.ts deletes remote
    // events missing from the vault it's pointed at), so only the installed app — or a human who
    // explicitly opted in — may run this ticker at all. A dev/test/agent core on a vault COPY
    // must never sync unattended. See gcalAutoSyncEnabled (core/src/gcal/manifest.ts).
    let gcalAutoSyncAt = 0
    let gcalAutoSyncRunning = false
    const gcalTicker = gcalAutoSyncEnabled()
        ? setInterval(() => {
              if (gcalAutoSyncRunning || !gcalStatus().connected) return
              const everyMs =
                  Math.max(
                      1,
                      appConfig.googleCalendar?.syncIntervalMinutes || 15,
                  ) * 60_000
              if (Date.now() - gcalAutoSyncAt < everyMs) return
              gcalAutoSyncAt = Date.now()
              gcalAutoSyncRunning = true
              const { policy, timeZone, theme } = gcalConnectionArgs(appConfig)
              const legacy = legacyGcalConfig(appConfig)
              void (async () => {
                  const targets = await listGcalSyncTargets(cfg.vault, legacy)
                  for (const t of targets) {
                      await gcalSync(
                          cfg.vault,
                          t.basePath,
                          t.calendarId,
                          policy,
                          timeZone,
                          theme,
                      ).catch(e =>
                          console.error(
                              `[gcal] auto-sync failed for ${t.basePath}: ${(e as Error).message}`,
                          ),
                      )
                  }
              })()
                  // The per-base sync above is already error-tolerant; the vault SCAN that produces the
                  // list was not — listGcalSyncTargets rejects outright when the vault dir is unreadable
                  // or gone, and an uncaught rejection here surfaces as a bare process-level error with
                  // no indication of which vault it came from. Name the vault and keep the ticker alive.
                  .catch(e =>
                      console.error(
                          `[gcal] auto-sync scan failed for ${cfg.vault}: ${(e as Error).message}`,
                      ),
                  )
                  .finally(() => {
                      gcalAutoSyncRunning = false
                  })
          }, gcalTickMs())
        : undefined
    if (gcalTicker) gcalTicker.unref()
    else
        console.log(
            '[gcal] auto-sync off outside the installed app (set BISMUTH_GCAL_AUTOSYNC=1 to enable)',
        )

    // Teardown rides the verbs a caller already uses to shut a server down — rather than a separate
    // disposer or an augmented return type, so the returned value stays exactly Bun's `Server` and
    // every existing call site is unchanged. Anything else would leave the leak in place for
    // every caller that didn't adopt the new API, which is the whole problem. Idempotent
    // (clearInterval on a cleared handle is a no-op), and stop()'s argument + Promise result are
    // forwarded untouched, so `stop()` / `stop(true)` behave as before in every other respect.
    const stopHttp = server.stop.bind(server)
    const shutdown = (closeActiveConnections?: boolean): Promise<void> => {
        stopped = true
        // Aborts an in-flight graph build and the boot view warm-up, freeing the shared layout worker.
        graphCache.invalidate()
        clearInterval(gcalTicker)
        for (const w of watchers.splice(0)) w.close()
        return stopHttp(closeActiveConnections)
    }
    server.stop = shutdown

    // Bun's `Server` is `Disposable`, so `using server = createServer(…)` is a SECOND shutdown verb:
    // it closes the listener through Bun's own `Symbol.dispose` without ever reaching stop() above.
    // Route it through the same teardown, or a disposed server keeps ticking. Defined rather than
    // assigned because Bun's prototype property is non-writable (`writable: false`) — a plain
    // assignment throws in strict mode, which every module here is.
    Object.defineProperty(server, Symbol.dispose, {
        value: () => {
            void shutdown(true)
        },
        configurable: true,
    })

    Object.defineProperty(server, 'routeKeys', {
        value: [...Object.keys(routes), ...Object.keys(mutatingRoutes)],
    })

    return server
}

if (import.meta.main) {
    const vault = cliArg('vault') ?? process.env.BISMUTH_VAULT
    const memory = cliArg('memory') ?? process.env.BISMUTH_MEMORY
    if (!vault || !memory) {
        console.error(
            'usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]',
        )
        process.exit(1)
    }
    const portArg = cliArg('port')
    const s = createServer({
        vault,
        memory,
        port: portArg ? Number(portArg) : 4321,
    })
    console.log(`core listening on http://localhost:${s.port}`)

    // Self-terminate when the owning desktop app process is gone, so we never leave an
    // orphaned core behind a crashed / force-quit app (Tauri's RunEvent::Exit doesn't fire
    // then) or after the window owning an open-folder sibling backend closes. The Tauri shell
    // passes BISMUTH_APP_PID; open-folder siblings inherit it via Bun.spawn's env. Absent in dev
    // (`bun run dev:browser`) → no-op. signal 0 only probes liveness; the timer is unref'd so it never
    // keeps the process alive on its own.
    const ownerPid = Number(process.env.BISMUTH_APP_PID)
    if (Number.isInteger(ownerPid) && ownerPid > 0) {
        setInterval(() => {
            try {
                process.kill(ownerPid, 0)
            } catch {
                console.log(`core exiting: owner app pid ${ownerPid} is gone`)
                process.exit(0)
            }
        }, 5000).unref()
    }

    // Bundled app: ensure the machine-wide bismuth CLI + MCP are installed/current from the
    // staged tools resource (BISMUTH_INSTALL_SRC). Version-gated → no-op when unchanged.
    // Best-effort + non-blocking; never crashes the server.
    if (process.env.BISMUTH_INSTALL_SRC) {
        // `mcp.registerWith` names the OTHER agent CLIs the user opted into (Claude always registers).
        // Read here rather than inside the installer so bismuthInstall.ts stays settings-agnostic and
        // unit-testable; an unreadable settings file yields [] and changes nothing.
        readMcpRegisterWith(vault)
            .catch(() => [] as string[])
            .then(registerWith =>
                ensureBismuthInstalled(
                    process.env.BISMUTH_INSTALL_SRC,
                    undefined,
                    { registerWith },
                ),
            )
            .then(r => {
                console.log(`bismuth tools: ${r.action}`)
                for (const w of r.warnings) console.warn(`bismuth tools: ${w}`)
            })
            .catch(e =>
                console.warn(
                    `bismuth tools install failed: ${e?.message ?? e}`,
                ),
            )
            // Then the doctor's SAFE repairs (stale links, old-home service units, orphan files).
            // Destructive ones stay pending for the launch toast. Runs after the ensure settles so
            // it sees the freshly installed state; bootDoctor never throws.
            .then(async () => {
                if (process.env.BISMUTH_NO_BOOT_DOCTOR === '1') return
                for (const line of await bootDoctor(vault)) console.log(line)
            })
    }
}
