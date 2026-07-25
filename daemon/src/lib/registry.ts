import { readFile, writeFile, rename } from "node:fs/promises"
import { join } from "node:path"
import { parse } from "yaml"
import { parseFrontmatter } from "./frontmatter.ts"
import { VAULTS_FILE, vaultPaths, type VaultContext } from "./config.ts"

// The set of vault brains the daemon runs. Bismuth core writes the list of known vault
// roots to <MACHINE_DIR>/vaults.json on vault open; each vault opts in via
// settings.daemon.enabled. The cron/process loops iterate loadEnabledVaults() every tick,
// so enabling/disabling a vault's daemon takes effect without restarting the runtime.

/** Known vault roots (written by core). Each element is either the legacy plain path string, or
 *  (since core added a `lastSeenISO`-stamped TTL registry) a `{path,lastSeenISO}` object — this
 *  reads either shape, since core self-heals in place rather than doing a flag-day migration.
 *  Returns [] if the registry is absent/malformed. */
async function knownVaultRoots(): Promise<string[]> {
  try {
    const arr = JSON.parse(await readFile(VAULTS_FILE, "utf-8"))
    if (!Array.isArray(arr)) return []
    const out: string[] = []
    for (const entry of arr) {
      if (typeof entry === "string") out.push(entry)
      else if (entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string") {
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
}

/** A vault's daemon config: the `enabled` master switch from the vault's `.settings` file, and the
 *  `name` from the .daemon/identity.md frontmatter (the name lives WITH the identity, not in
 *  settings). A missing/corrupt settings reads as disabled; a missing identity → default name.
 *  Never throws. */
async function readDaemonSettings(root: string): Promise<DaemonSettings> {
  let enabled = false
  // Settings live in the single `.settings` file. The daemon is a separate process that may read a
  // vault BEFORE core migrates it, so fall back to the interim `.settings/settings.yaml` and the
  // legacy root `settings.yaml` — first readable wins. (Reading a dir, e.g. an interim `.settings/`,
  // throws → we just try the next shape.)
  for (const rel of [".settings", join(".settings", "settings.yaml"), "settings.yaml"]) {
    try {
      const doc = parse(await readFile(join(root, rel), "utf-8")) as
        | { daemon?: { enabled?: unknown } }
        | null
      if (doc !== null) { enabled = doc.daemon?.enabled === true; break }
    } catch {
      // unreadable/missing/dir → try the next shape
    }
  }

  let name = ""
  try {
    const { frontmatter } = parseFrontmatter(await readFile(join(root, ".daemon", "identity.md"), "utf-8"))
    if (typeof frontmatter.name === "string") name = frontmatter.name
  } catch {
    // no identity.md → vaultPaths falls back to "daemon"
  }

  return { enabled, name }
}

// ── "Last seen" must mean "actually in use" ───────────────────────────────────────────────────
//
// Core stamps a vault's `lastSeenISO` when a core boots against it — i.e. when the user OPENS it in
// the app — and retires any entry unstamped for 30 days (VAULT_REGISTRY_TTL_MS in core/src/
// daemon.ts). But the long-running CONSUMER of vaults.json is THIS process: it iterates the list
// every cron tick, for vaults whose crons fire hourly and which the user may not open for months.
// With core as the only writer, "last seen" silently meant "last app launch", and such a vault
// would be dropped on some other vault's next core boot — every one of its crons stopping forever.
//
// So the daemon refreshes the stamp for the vaults it actually serves. Serving a brain is the
// honest signal; this is the loop that already knows which those are.

/** One `vaults.json` entry as core now writes it. */
export interface VaultRegistryEntry {
  path: string
  lastSeenISO: string
}

/** How often {@link refreshVaultsSeen} is allowed to rewrite vaults.json. The TTL it protects is
 *  30 days, so hourly is ample; the throttle just keeps a 60s cron tick from rewriting a file
 *  1,440 times a day (and racing core's own writer that often). */
export const VAULT_SEEN_REFRESH_MS = 60 * 60 * 1000

/**
 * Merge `lastSeenISO: nowISO` into the entries for `roots`. PURE — the IO lives in
 * {@link refreshVaultsSeen}, so the merge rule is directly testable.
 *
 * Preserves everything else verbatim: order, unrelated vaults, and their stamps. Roots NOT already
 * in the file are ignored rather than added — core owns MEMBERSHIP, the daemon only ever refreshes
 * what is already registered, so a stale in-memory root can never resurrect a retired vault. Legacy
 * plain-string entries are upgraded in place to the object shape (unstamped unless they're being
 * refreshed, which is exactly how core treats them: unknown, not ancient).
 *
 * `changed` is false when nothing needed touching, so the caller can skip the write entirely.
 */
export function stampVaultsSeen(
  raw: unknown,
  roots: Iterable<string>,
  nowISO: string,
): { entries: VaultRegistryEntry[]; changed: boolean } {
  const wanted = new Set(roots)
  const entries: VaultRegistryEntry[] = []
  let changed = false
  if (!Array.isArray(raw)) return { entries, changed }
  for (const item of raw) {
    let path: string | undefined
    let lastSeenISO = ""
    if (typeof item === "string") {
      path = item
    } else if (item && typeof item === "object") {
      const p = (item as { path?: unknown }).path
      const s = (item as { lastSeenISO?: unknown }).lastSeenISO
      if (typeof p === "string") path = p
      if (typeof s === "string") lastSeenISO = s
    }
    if (!path) continue // malformed element — drop it, same as core's normalizeVaultEntry
    if (wanted.has(path)) {
      if (lastSeenISO !== nowISO) changed = true
      lastSeenISO = nowISO
    }
    entries.push({ path, lastSeenISO })
  }
  return { entries, changed }
}

let lastStampMs = 0

/** Reset the refresh throttle. Test-only seam — the throttle is module state, and a test that
 *  wants to observe two successive refreshes must be able to clear it. */
export function resetVaultsSeenThrottle(): void {
  lastStampMs = 0
}

/**
 * Stamp `lastSeenISO: now` on every root in `roots` (see the block comment above). Throttled to
 * {@link VAULT_SEEN_REFRESH_MS} unless `force`. Best-effort and NEVER throws: a failed refresh must
 * not delay or break a cron tick — the next tick simply retries. Writes temp-then-rename, matching
 * core's writer, so the daemon can never hand core a half-written file.
 */
export async function refreshVaultsSeen(
  roots: string[],
  opts: { force?: boolean; file?: string; now?: number } = {},
): Promise<void> {
  if (roots.length === 0) return
  const nowMs = opts.now ?? Date.now()
  if (!opts.force && lastStampMs !== 0 && nowMs - lastStampMs < VAULT_SEEN_REFRESH_MS) return
  lastStampMs = nowMs
  const file = opts.file ?? VAULTS_FILE
  try {
    const raw = JSON.parse(await readFile(file, "utf-8"))
    const { entries, changed } = stampVaultsSeen(raw, roots, new Date(nowMs).toISOString())
    if (!changed) return
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(entries, null, 2))
    await rename(tmp, file)
  } catch {
    // absent/malformed/unwritable — the registry is core's to own; we only ever refresh it
  }
}

/** Every known vault whose daemon is ENABLED, resolved to a VaultContext. The multiplex
 *  set: the cron/process/session loops iterate this. */
export async function loadEnabledVaults(): Promise<VaultContext[]> {
  const out: VaultContext[] = []
  for (const root of await knownVaultRoots()) {
    const s = await readDaemonSettings(root)
    if (s.enabled) out.push(vaultPaths(root, s.name))
  }
  // Serving these vaults IS the "still in use" signal core's TTL is asking about — record it.
  // Fire-and-forget + throttled: a cron tick never waits on a registry write.
  void refreshVaultsSeen(out.map((c) => c.root))
  return out
}

/** Every known vault with its enabled flag — for the reconcile loop that boots a newly
 *  enabled vault's brain and tears down one that flipped disabled. */
export async function loadAllVaults(): Promise<Array<{ ctx: VaultContext; enabled: boolean }>> {
  const out: Array<{ ctx: VaultContext; enabled: boolean }> = []
  for (const root of await knownVaultRoots()) {
    const s = await readDaemonSettings(root)
    out.push({ ctx: vaultPaths(root, s.name), enabled: s.enabled })
  }
  return out
}
