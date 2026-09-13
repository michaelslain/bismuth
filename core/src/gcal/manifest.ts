// core/src/gcal/manifest.ts
// Sync bookkeeping kept OUTSIDE the vault: per calendar base, the map from a Google event
// id → the local Bismuth row id (plus the last-seen etag/updated for conflict handling).
// Storing this here — rather than as columns on the event rows — keeps the calendar base
// file clean and survives the frontend's calendar serializer, which only re-emits known
// event fields and would otherwise drop any extra sync columns on the next in-app edit.
//
// PER-CALENDAR: the manifest is keyed by base path, so a vault with several synced
// calendars keeps a SEPARATE link map + sync token + calendar target per base — two
// calendars can never clobber each other's links (which the old single-base manifest's
// retarget-guard papered over by wiping links whenever the bound base changed).
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
    mkdirSync,
    readFileSync,
    writeFileSync,
    chmodSync,
    rmSync,
    existsSync,
    realpathSync,
} from 'node:fs'

export interface SyncLink {
    bismuthId: string
    etag?: string
    updated?: string // remote `updated` at last sync (remote-change detection)
    sig?: string // content signature at last sync (local-change detection)
}

/** The sync state for ONE calendar base ↔ ONE Google calendar. */
export interface BaseSync {
    lastSyncAt?: string
    syncToken?: string // Google incremental-sync token (absent → next sync is a full sync)
    calendarId?: string // the Google calendar this base was last reconciled against — if it
    // changes (the base was pointed at a different Google calendar), links + token are dropped.
    links: Record<string, SyncLink> // keyed by Google event id
}

export interface SyncManifest {
    bases: Record<string, BaseSync> // keyed by the calendar base's vault path
}

/**
 * Where the durable Google-Calendar credentials + sync manifest live: `~/.bismuth/gcal`,
 * or BISMUTH_GCAL_DIR when set (the same override BISMUTH_RUN_DIR / BISMUTH_CHAT_DIR /
 * BISMUTH_DAEMON_DIR give their machine-wide dirs). This dir holds a real refresh token and
 * sits OUTSIDE every vault, so a process that must not touch the user's Google account — a
 * test run, a sandbox — has no other way to be isolated from it. An explicit `home` argument
 * still wins, so a caller that names a home means that home.
 */
export function gcalDir(home?: string): string {
    if (home === undefined && process.env.BISMUTH_GCAL_DIR)
        return process.env.BISMUTH_GCAL_DIR
    return join(home ?? homedir(), '.bismuth', 'gcal')
}
function manifestPath(home?: string): string {
    return join(gcalDir(home), 'sync.json')
}

/**
 * Read the sync manifest; returns an empty one if absent or unreadable (never throws).
 * MIGRATES the old single-base shape ({ links, basePath, syncToken, lastSyncAt }) into the
 * per-base map ({ bases: { [basePath]: { links, syncToken, lastSyncAt } } }) so an existing
 * vault keeps its links + incremental token across the upgrade.
 */
export function readManifest(home?: string): SyncManifest {
    try {
        const obj = JSON.parse(
            readFileSync(manifestPath(home), 'utf8'),
        ) as Record<string, unknown>
        if (obj && typeof obj === 'object') {
            if (obj.bases && typeof obj.bases === 'object')
                return { bases: obj.bases as Record<string, BaseSync> }
            // Legacy single-base manifest → nest it under its bound base path.
            if (obj.links && typeof obj.links === 'object') {
                const basePath =
                    typeof obj.basePath === 'string' ? obj.basePath : ''
                const entry: BaseSync = {
                    links: obj.links as Record<string, SyncLink>,
                    syncToken:
                        typeof obj.syncToken === 'string'
                            ? obj.syncToken
                            : undefined,
                    lastSyncAt:
                        typeof obj.lastSyncAt === 'string'
                            ? obj.lastSyncAt
                            : undefined,
                }
                return { bases: basePath ? { [basePath]: entry } : {} }
            }
        }
    } catch {
        /* fall through to empty */
    }
    return { bases: {} }
}

/** The BaseSync entry for one base, creating (and MUTATING `m` with) an empty one if it doesn't
 *  exist yet — keyed by bare base path only, with no vault namespacing.
 *
 *  LEGACY / no current non-test callers: neither `sync.ts` (see `baseSyncFor` below) nor
 *  `cli/src/commands/gcal.ts`'s `gcal health` (which must be READ-ONLY and does its own
 *  namespaced-then-legacy lookup inline) calls this anymore. Kept exported, unmutated
 *  otherwise, for `core/test/gcal/manifest.test.ts`'s existing coverage of the bare-key shape —
 *  not deleted, since removing a still-tested, still-correct function is out of this task's
 *  scope. */
export function baseSyncOf(m: SyncManifest, basePath: string): BaseSync {
    let bs = m.bases[basePath]
    if (!bs) {
        bs = { links: {} }
        m.bases[basePath] = bs
    }
    return bs
}

/**
 * The manifest key for one base in one vault: `${realpath(vault)}::${basePath}`. Namespacing
 * by vault (not just base path) is the fix for the data-safety bug this file exists to close —
 * a dev/test/agent core running against a COPY of the real vault must never share the real
 * vault's links + sync token, or its Phase C (`sync.ts`) deletes the user's real Google Calendar
 * events out from under them. `realpathSync` (not the raw string) so `/tmp` and `/private/tmp`
 * spellings of the same directory agree; falls back to `path.resolve` when the vault doesn't
 * exist yet (a brand-new vault, or a test fixture vault that was never materialized on disk).
 */
export function manifestKey(vault: string, basePath: string): string {
    let v: string
    try {
        v = realpathSync(vault)
    } catch {
        v = resolve(vault)
    }
    return `${v}::${basePath}`
}

/**
 * The namespaced BaseSync entry for one base in one vault.
 *
 * Returns the namespaced entry if one already exists. Otherwise, when `claimLegacy` is true AND
 * a legacy bare entry (`m.bases[basePath]`, from before per-vault namespacing existed) is
 * present, MOVES it to the namespaced key (deletes the bare key) and returns it — a one-time
 * claim, not a copy, so the legacy entry can never be read from two vaults at once. Otherwise
 * creates a fresh, empty namespaced entry. An unclaimed legacy entry is never read, mutated or
 * deleted — it simply sits there until the one caller allowed to claim it (see
 * `gcalAutoSyncEnabled` below) does.
 */
export function baseSyncFor(
    m: SyncManifest,
    vault: string,
    basePath: string,
    opts: { claimLegacy: boolean },
): BaseSync {
    const key = manifestKey(vault, basePath)
    const existing = m.bases[key]
    if (existing) return existing
    if (opts.claimLegacy) {
        const legacy = m.bases[basePath]
        if (legacy) {
            delete m.bases[basePath]
            m.bases[key] = legacy
            return legacy
        }
    }
    const fresh: BaseSync = { links: {} }
    m.bases[key] = fresh
    return fresh
}

/**
 * Whether THIS core should run the background Google-Calendar auto-sync ticker at all
 * (`server.ts`). Off by default for every dev/test/agent core — auto-sync writes to the user's
 * real Google Calendar (Phase C of `sync.ts` deletes remote events missing from the vault it's
 * pointed at), so a core started against a vault COPY must never run it unattended. On only for
 * the installed app (`BISMUTH_APP_PATH`, set by the Tauri sidecar — `app/src-tauri/src/lib.rs`)
 * or when a human explicitly opts in with `BISMUTH_GCAL_AUTOSYNC=1` (e.g. to test auto-sync
 * itself against a throwaway calendar). `env` defaults to `process.env`; tests pass a plain
 * object so they never depend on ambient process state.
 */
export function gcalAutoSyncEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return !!env.BISMUTH_APP_PATH || env.BISMUTH_GCAL_AUTOSYNC === '1'
}

/** Persist the manifest (creating the dir 0700, file 0600). */
export function writeManifest(m: SyncManifest, home?: string): void {
    mkdirSync(gcalDir(home), { recursive: true, mode: 0o700 })
    const path = manifestPath(home)
    writeFileSync(path, JSON.stringify(m, null, 2), { mode: 0o600 })
    try {
        chmodSync(path, 0o600)
    } catch {
        /* best effort */
    }
}

/** Delete the whole manifest (on disconnect). Never throws. */
export function clearManifest(home?: string): void {
    try {
        if (existsSync(manifestPath(home))) rmSync(manifestPath(home))
    } catch {
        /* ignore */
    }
}
