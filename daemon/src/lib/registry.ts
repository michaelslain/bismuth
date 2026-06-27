import { readFile } from "fs/promises"
import { join } from "path"
import { parse } from "yaml"
import { parseFrontmatter } from "./frontmatter.ts"
import { VAULTS_FILE, vaultPaths, type VaultContext } from "./config.ts"

// The set of vault brains the daemon runs. Bismuth core writes the list of known vault
// roots to <MACHINE_DIR>/vaults.json on vault open; each vault opts in via
// settings.daemon.enabled. The cron/process loops iterate loadEnabledVaults() every tick,
// so enabling/disabling a vault's daemon takes effect without restarting the runtime.

/** Known vault roots (written by core). Returns [] if the registry is absent/malformed. */
async function knownVaultRoots(): Promise<string[]> {
  try {
    const arr = JSON.parse(await readFile(VAULTS_FILE, "utf-8"))
    return Array.isArray(arr) ? arr.filter((r): r is string => typeof r === "string") : []
  } catch {
    return []
  }
}

interface DaemonSettings {
  enabled: boolean
  name: string
}

/** A vault's daemon config: the `enabled` master switch from .settings/settings.yaml, and the
 *  `name` from the .daemon/identity.md frontmatter (the name lives WITH the identity, not in
 *  settings). A missing/corrupt settings reads as disabled; a missing identity → default name.
 *  Never throws. */
async function readDaemonSettings(root: string): Promise<DaemonSettings> {
  let enabled = false
  try {
    const doc = parse(await readFile(join(root, ".settings", "settings.yaml"), "utf-8")) as
      | { daemon?: { enabled?: unknown } }
      | null
    enabled = doc?.daemon?.enabled === true
  } catch {
    // no/corrupt settings → disabled
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

/** Every known vault whose daemon is ENABLED, resolved to a VaultContext. The multiplex
 *  set: the cron/process/session loops iterate this. */
export async function loadEnabledVaults(): Promise<VaultContext[]> {
  const out: VaultContext[] = []
  for (const root of await knownVaultRoots()) {
    const s = await readDaemonSettings(root)
    if (s.enabled) out.push(vaultPaths(root, s.name))
  }
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
