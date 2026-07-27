// The single declarative registry of everything the daemon seeds into a vault's .daemon — the
// analog of core's reconcileSettings. `reconcileSeeds(ctx)` runs every time a vault's brain comes
// online (boot or runtime-enable) and:
//   • writes any seed that's entirely MISSING (a fresh vault gets the full set; an already-set-up
//     vault that predates a NEW seedable gets JUST that new piece on next boot), and
//   • for the small set of seeds that opt into VERSIONED REFRESH (currently the two default crons
//     — see `refreshKey` below), UPGRADES an existing file in place IF AND ONLY IF it still matches
//     a known PRIOR stock version byte-for-byte. A file that doesn't match any known version (the
//     user edited it, even by one character) is left alone, always — this is how "dream" and
//     "vault-review" ship their new incremental-scoping behavior to EXISTING vaults automatically
//     (Bug: without this, the two default crons would only ever get better for brand-new vaults —
//     every existing install would be stuck on the old re-read-everything version forever, since
//     the plain "write if missing" rule never touches a file that's already there).
//
// To add a new seeded artifact later, append ONE entry to seedsFor() below. To ship a content
// change to an EXISTING versioned seed, see the instructions on PRIOR_SEED_HASHES.
import { existsSync } from "node:fs"
import { writeFile, mkdir, readFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import type { VaultContext } from "../lib/config.ts"
import { DEFAULT_DAEMON_IDENTITY } from "./session.ts"
import { DEFAULT_CRONS } from "./defaultCrons.ts"
import { PAGES_GUIDE } from "./pagesGuide.ts"

export interface Seed {
  /** Absolute path of the file to seed. */
  path: string
  /** Full contents written verbatim when the file is absent (or, for a refreshable seed, when an
   *  existing file matches a known prior version — see `refreshKey`). */
  content: string
  /** Present only on seeds that opt into versioned refresh (the default crons). Keys into
   *  PRIOR_SEED_HASHES so reconcileSeeds can tell "still stock, safe to upgrade" apart from
   *  "user-customized, leave it". Seeds without this key (identity.md, PAGES.md) are written once
   *  and never touched again, exactly as before. */
  refreshKey?: string
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex")
}

/**
 * SHA-256 of every PRIOR (i.e. no longer current) stock version of a refreshable seed's exact
 * byte content, oldest → newest. `reconcileSeeds` uses this to recognize an on-disk file that
 * still matches a version WE shipped (safe to overwrite with the current version) as distinct
 * from one the user has since edited (left untouched, forever, even across future versions).
 *
 * APPEND-ONLY, and update this at the SAME TIME you change a DEFAULT_CRONS entry's content:
 * push the OUTGOING content's hash onto that cron's array BEFORE changing defaultCrons.ts, never
 * remove or reorder an existing entry (a vault still running an even-older stock version must
 * keep matching). The current content itself is never listed here — reconcileSeeds compares
 * against `seed.content` (the live DEFAULT_CRONS export) directly for the "already up to date"
 * case, so listing it here too would just be redundant, not wrong.
 */
const PRIOR_SEED_HASHES: Record<string, string[]> = {
  // v1: pre-incremental. No `incremental: true` frontmatter, no `{{changedSinceLastRun}}`; the
  // prompt itself ran `bismuth checkpoint diff/advance` as its first/last Bash step, which quietly
  // degraded to a full re-survey every run whenever the bismuth CLI wasn't resolvable on PATH
  // (Bug #105). v2 (the current DEFAULT_CRONS content) moved that scoping into the daemon itself.
  dream: ["302a7a4eafa8a5ba956ebb278462d47adf57daa8ad12bb7c098a2b7587c2aa63"],
  "vault-review": ["7cd2b6ddef11d432b17510271e952830ac58f9ca0c53f0c261d7494ca7e0c060"],
}

/** Everything the daemon seeds for one vault, resolved to absolute paths. The ONE place to add
 *  future seedables (a new default cron, a config file, a template, …). */
export function seedsFor(ctx: VaultContext): Seed[] {
  return [
    // The daemon's identity (name in frontmatter + personality body).
    { path: ctx.identityFile, content: `---\nname: daemon\n---\n\n${DEFAULT_DAEMON_IDENTITY}\n` },
    // The default background jobs — versioned/refreshable (see PRIOR_SEED_HASHES).
    ...DEFAULT_CRONS.map((c) => ({ path: join(ctx.cronsDir, `${c.name}.md`), content: c.content, refreshKey: c.name })),
    // Format-discovery doc for the daemon-inbox page format (see core/src/daemonPages.ts) — no
    // execution cron; pages are fired by runtime code (pages.ts), not a user-deletable cron.
    { path: join(ctx.daemonDir, "PAGES.md"), content: PAGES_GUIDE },
  ]
}

export interface SeedReconcileResult {
  /** Seed files written because nothing existed at that path yet. */
  written: string[]
  /** Existing seed files upgraded in place because they still matched a known PRIOR stock
   *  version — i.e. the user never customized them. */
  refreshed: string[]
  /** Existing seed files left untouched because they don't match the current OR any known prior
   *  stock version — the user customized them, so a content change here never clobbers it. */
  customized: string[]
}

/**
 * Reconcile every registered seed for this vault:
 *   - missing → write it,
 *   - present + versioned (`refreshKey`) + byte-identical to a known PRIOR stock version →
 *     upgrade it to the current version,
 *   - present + versioned + matches neither the prior nor current stock version → leave it,
 *     record it as customized,
 *   - present + not versioned (identity.md, PAGES.md) → leave it, exactly as before.
 * Idempotent + incremental; best-effort per file (one failure never blocks the rest, and is
 * simply retried on the next brain-start).
 */
export async function reconcileSeeds(ctx: VaultContext): Promise<SeedReconcileResult> {
  const result: SeedReconcileResult = { written: [], refreshed: [], customized: [] }
  for (const seed of seedsFor(ctx)) {
    try {
      if (!existsSync(seed.path)) {
        await mkdir(dirname(seed.path), { recursive: true })
        await writeFile(seed.path, seed.content, "utf-8")
        result.written.push(seed.path)
        continue
      }

      if (!seed.refreshKey) continue // non-versioned seed: present → never touched
      const priorHashes = PRIOR_SEED_HASHES[seed.refreshKey]
      if (!priorHashes || priorHashes.length === 0) continue // no known history to upgrade from

      const onDisk = await readFile(seed.path, "utf-8")
      if (onDisk === seed.content) continue // already current, nothing to do

      if (priorHashes.includes(sha256(onDisk))) {
        await writeFile(seed.path, seed.content, "utf-8")
        result.refreshed.push(seed.path)
        console.log(`[seeds] upgraded "${seed.path}" (matched a known stock version)`)
      } else {
        result.customized.push(seed.path)
        console.log(`[seeds] leaving "${seed.path}" untouched — doesn't match a known stock version (user-customized)`)
      }
    } catch {
      // best-effort: a seed that fails to write/refresh is retried on the next brain-start
    }
  }
  return result
}
