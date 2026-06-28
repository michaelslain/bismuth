// The single declarative registry of everything the daemon seeds into a vault's .daemon — the
// analog of core's reconcileSettings. `reconcileSeeds(ctx)` runs every time a vault's brain comes
// online (boot or runtime-enable) and writes only what's MISSING, so:
//   • a fresh vault gets the full set, and
//   • an already-set-up vault that predates a NEW seedable gets JUST that new piece on next boot —
//     existing files are never touched (user edits + deliberate `enabled: false` are preserved).
//
// To add a new seeded artifact later, append ONE entry to seedsFor() below. That's the whole API:
// incremental, non-clobbering seeding falls out for free, for every existing install.
import { existsSync } from "fs"
import { writeFile, mkdir } from "fs/promises"
import { dirname, join } from "path"
import type { VaultContext } from "../lib/config.ts"
import { DEFAULT_DAEMON_IDENTITY } from "./session.ts"
import { DEFAULT_CRONS } from "./defaultCrons.ts"

export interface Seed {
  /** Absolute path of the file to seed. */
  path: string
  /** Full contents written verbatim when the file is absent. */
  content: string
}

/** Everything the daemon seeds for one vault, resolved to absolute paths. The ONE place to add
 *  future seedables (a new default cron, a config file, a template, …). */
export function seedsFor(ctx: VaultContext): Seed[] {
  return [
    // The daemon's identity (name in frontmatter + personality body).
    { path: ctx.identityFile, content: `---\nname: daemon\n---\n\n${DEFAULT_DAEMON_IDENTITY}\n` },
    // The default background jobs.
    ...DEFAULT_CRONS.map((c) => ({ path: join(ctx.cronsDir, `${c.name}.md`), content: c.content })),
  ]
}

/** Write every registered seed that's MISSING for this vault; leave existing files untouched.
 *  Idempotent + incremental: re-running only fills gaps (e.g. a newly-added default), never
 *  clobbers. Best-effort per file — one failure never blocks the rest. */
export async function reconcileSeeds(ctx: VaultContext): Promise<void> {
  for (const seed of seedsFor(ctx)) {
    if (existsSync(seed.path)) continue
    try {
      await mkdir(dirname(seed.path), { recursive: true })
      await writeFile(seed.path, seed.content, "utf-8")
    } catch {
      // best-effort: a seed that fails to write is retried on the next brain-start
    }
  }
}
