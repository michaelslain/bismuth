import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { parseFrontmatter } from './frontmatter.ts'
import {
    VAULTS_FILE,
    VAULTS_SEEN_FILE,
    vaultPaths,
    type VaultContext,
} from './config.ts'

// The set of vault brains the daemon runs. Bismuth core writes the list of known vault
// roots to <MACHINE_DIR>/vaults.json on vault open; each vault opts in via
// settings.daemon.enabled. The cron/process loops iterate loadEnabledVaults() every tick,
// so enabling/disabling a vault's daemon takes effect without restarting the runtime.

/** Known vault roots (written by core): a plain array of path strings — the ONE shape core writes,
 *  and the one an installed binary of any vintage understands. A `{path,...}` object is also
 *  accepted for the machines where a pre-release build briefly wrote that shape (core migrates
 *  them back to strings on its next boot); nothing produces it now. Returns [] if the registry is
 *  absent/malformed. */
async function knownVaultRoots(): Promise<string[]> {
    try {
        const arr = JSON.parse(await readFile(VAULTS_FILE, 'utf-8'))
        if (!Array.isArray(arr)) return []
        const out: string[] = []
        for (const entry of arr) {
            if (typeof entry === 'string') out.push(entry)
            else if (
                entry &&
                typeof entry === 'object' &&
                typeof (entry as { path?: unknown }).path === 'string'
            ) {
                out.push((entry as { path: string }).path)
            }
        }
        return out
    } catch {
        return []
    }
}

interface DaemonSettings {
    enabled: boolean
    name: string
    /** settings.daemon.backend — a REQUEST, not a grant; session.ts's resolveDaemonBackend is the
     *  actual gate. Defaults to "claude" on anything missing/malformed. */
    backend: string
    /** settings.codex.writeAgentsMd — opt-in, default false; see VaultContext.codexWriteAgentsMd. */
    codexWriteAgentsMd: boolean
    /** settings.daemon.inheritUserMcp — opt-in, default false; see VaultContext.inheritUserMcp. */
    inheritUserMcp: boolean
}

/** A vault's daemon config: the `enabled` master switch + `backend`/`codexWriteAgentsMd` choices
 *  from the vault's `.settings` file, and the `name` from the .daemon/identity.md frontmatter (the
 *  name lives WITH the identity, not in settings). A missing/corrupt settings reads as disabled +
 *  "claude" + off; a missing identity → default name. Never throws. */
async function readDaemonSettings(root: string): Promise<DaemonSettings> {
    let enabled = false
    let backend = 'claude'
    let codexWriteAgentsMd = false
    let inheritUserMcp = false
    // Settings live in the single `.settings` file. The daemon is a separate process that may read a
    // vault BEFORE core migrates it, so fall back to the interim `.settings/settings.yaml` and the
    // legacy root `settings.yaml` — first readable wins. (Reading a dir, e.g. an interim `.settings/`,
    // throws → we just try the next shape.)
    for (const rel of [
        '.settings',
        join('.settings', 'settings.yaml'),
        'settings.yaml',
    ]) {
        try {
            const doc = parse(await readFile(join(root, rel), 'utf-8')) as {
                daemon?: {
                    enabled?: unknown
                    backend?: unknown
                    inheritUserMcp?: unknown
                }
                codex?: { writeAgentsMd?: unknown }
            } | null
            if (doc !== null) {
                enabled = doc.daemon?.enabled === true
                if (
                    typeof doc.daemon?.backend === 'string' &&
                    doc.daemon.backend.trim()
                )
                    backend = doc.daemon.backend.trim()
                codexWriteAgentsMd = doc.codex?.writeAgentsMd === true
                inheritUserMcp = doc.daemon?.inheritUserMcp === true
                break
            }
        } catch {
            // unreadable/missing/dir → try the next shape
        }
    }

    let name = ''
    try {
        const { frontmatter } = parseFrontmatter(
            await readFile(join(root, '.daemon', 'identity.md'), 'utf-8'),
        )
        if (typeof frontmatter.name === 'string') name = frontmatter.name
    } catch {
        // no identity.md → vaultPaths falls back to "daemon"
    }

    return { enabled, name, backend, codexWriteAgentsMd, inheritUserMcp }
}

// ── "Last seen" must mean "actually in use" ───────────────────────────────────────────────────
//
// Core stamps a vault when a core boots against it — i.e. when the user OPENS it in the app — and
// retires any vault unstamped for 30 days (VAULT_REGISTRY_TTL_MS in core/src/daemon.ts). But the
// long-running CONSUMER of vaults.json is THIS process: it iterates the list every cron tick, for
// vaults whose crons fire hourly and which the user may not open for months. With core as the only
// writer, "last seen" silently meant "last app launch", and such a vault would be dropped on some
// other vault's next core boot — every one of its crons stopping forever.
//
// So the daemon refreshes the stamp for the vaults it actually serves. Serving a brain is the
// honest signal; this is the loop that already knows which those are.
//
// The stamps live in VAULTS_SEEN_FILE, NOT in vaults.json. vaults.json is a frozen contract with a
// core that ships on its own schedule (and, in the mirror image of the hazard core guards against,
// with an OLDER core that would happily rewrite anything it does not understand). Keeping the two
// files separate means neither side can corrupt the other's format: the worst either can do to the
// sidecar is leave it stale, which costs one TTL cycle and no crons.

/** How often {@link refreshVaultsSeen} is allowed to rewrite the sidecar. The TTL it protects is
 *  30 days, so hourly is ample; the throttle just keeps a 60s cron tick from rewriting a file
 *  1,440 times a day (and racing core's own writer that often). */
export const VAULT_SEEN_REFRESH_MS = 60 * 60 * 1000

/**
 * Merge `nowISO` into the sidecar map for every root in `roots`. PURE — the IO lives in
 * {@link refreshVaultsSeen}, so the merge rule is directly testable.
 *
 * Preserves every other key verbatim. Adding a key here cannot resurrect anything: MEMBERSHIP
 * lives in vaults.json, which this process never writes, so a stamp for a vault core has retired
 * is inert and core prunes it on its next pass.
 *
 * `changed` is false when nothing needed touching, so the caller can skip the write entirely.
 */
export function stampVaultsSeen(
    raw: unknown,
    roots: Iterable<string>,
    nowISO: string,
): { seen: Record<string, string>; changed: boolean } {
    const seen: Record<string, string> = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [path, iso] of Object.entries(
            raw as Record<string, unknown>,
        )) {
            if (typeof iso === 'string' && iso) seen[path] = iso
        }
    }
    let changed = false
    for (const root of roots) {
        if (seen[root] === nowISO) continue
        seen[root] = nowISO
        changed = true
    }
    return { seen, changed }
}

let lastStampMs = 0

/** Reset the refresh throttle. Test-only seam — the throttle is module state, and a test that
 *  wants to observe two successive refreshes must be able to clear it. */
export function resetVaultsSeenThrottle(): void {
    lastStampMs = 0
}

/**
 * Stamp `now` on every root in `roots` in the sidecar (see the block comment above). Throttled to
 * {@link VAULT_SEEN_REFRESH_MS} unless `force`. Best-effort and NEVER throws: a failed refresh must
 * not delay or break a cron tick — the next tick simply retries. Writes temp-then-rename, matching
 * core's writer, so core can never read a half-written map.
 *
 * Refreshes an EXISTING sidecar only; it never creates one and never overwrites an unparseable
 * one. Core is the file's author, and it seeds a fresh sidecar by baselining EVERY registered
 * vault. If this process could create it, the first file on disk would hold only the vaults the
 * daemon serves — leaving every other registered vault looking "never seen" to core's TTL. Backing
 * off here makes core's absent/corrupt path (baseline everything, retire nothing) the one that
 * runs, which is the safe direction.
 */
export async function refreshVaultsSeen(
    roots: string[],
    opts: { force?: boolean; file?: string; now?: number } = {},
): Promise<void> {
    if (roots.length === 0) return
    const nowMs = opts.now ?? Date.now()
    if (
        !opts.force &&
        lastStampMs !== 0 &&
        nowMs - lastStampMs < VAULT_SEEN_REFRESH_MS
    )
        return
    lastStampMs = nowMs
    const file = opts.file ?? VAULTS_SEEN_FILE
    try {
        const raw = JSON.parse(await readFile(file, 'utf-8'))
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return // not core's map — leave it
        const { seen, changed } = stampVaultsSeen(
            raw,
            roots,
            new Date(nowMs).toISOString(),
        )
        if (!changed) return
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(seen, null, 2))
        await rename(tmp, file)
    } catch {
        // absent/malformed/unwritable — core owns this file's existence; we only ever refresh it
    }
}

/** Every known vault whose daemon is ENABLED, resolved to a VaultContext. The multiplex
 *  set: the cron/process/session loops iterate this. */
export async function loadEnabledVaults(): Promise<VaultContext[]> {
    const out: VaultContext[] = []
    for (const root of await knownVaultRoots()) {
        const s = await readDaemonSettings(root)
        if (s.enabled)
            out.push(
                vaultPaths(
                    root,
                    s.name,
                    s.backend,
                    s.codexWriteAgentsMd,
                    s.inheritUserMcp,
                ),
            )
    }
    // Serving these vaults IS the "still in use" signal core's TTL is asking about — record it.
    // Fire-and-forget + throttled: a cron tick never waits on a registry write.
    void refreshVaultsSeen(out.map(c => c.root))
    return out
}

/** Every known vault with its enabled flag — for the reconcile loop that boots a newly
 *  enabled vault's brain and tears down one that flipped disabled. */
export async function loadAllVaults(): Promise<
    Array<{ ctx: VaultContext; enabled: boolean }>
> {
    const out: Array<{ ctx: VaultContext; enabled: boolean }> = []
    for (const root of await knownVaultRoots()) {
        const s = await readDaemonSettings(root)
        out.push({
            ctx: vaultPaths(
                root,
                s.name,
                s.backend,
                s.codexWriteAgentsMd,
                s.inheritUserMcp,
            ),
            enabled: s.enabled,
        })
    }
    return out
}
