/**
 * app/scripts/devVault.ts — resolve which vault `bun run dev` / `bun run dev:app` should open, and
 * materialise the example one on first use.
 *
 * PRECEDENCE, most specific first:
 *   1. BISMUTH_VAULT / BISMUTH_MEMORY  — an explicit choice always wins, including a real vault.
 *   2. the generated example vault      — the default, so a bare `bun run dev` just works.
 *
 * The example lives at repo-root `.dev-vault/` (gitignored, alongside `.claude/`): it is a working
 * artifact, not source. Dev builds WRITE to their vault — autosave, task toggles, SRS scheduling —
 * so a committed fixture would show up as repo diffs the moment anyone clicked anything.
 *
 * MISSING FILES ARE RESTORED, EXISTING ONES ARE LEFT ALONE. That makes the vault durable across
 * restarts (your experiments survive) while `rm -rf .dev-vault` is always a clean reset. It also
 * means a file you deliberately delete comes back — which is the right trade for a fixture whose
 * job is to demonstrate features, and is why the reset is documented rather than hidden.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { DEV_VAULT_FILES, DEV_MEMORY_FILES } from './devVaultContent'

export type VaultChoice = {
    vault: string
    memory: string
    /** True when these paths came from the environment rather than the generated example. */
    explicit: boolean
    /** Files written this run (empty once the example vault already exists). */
    created: string[]
}

const writeMissing = (root: string, files: Record<string, string>): string[] => {
    const made: string[] = []
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(root, rel)
        if (existsSync(abs)) continue
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content)
        made.push(rel)
    }
    return made
}

export function resolveDevVault(env: NodeJS.ProcessEnv = process.env): VaultChoice {
    // Both or neither: a half-set pair is far more likely to be a stale export than an intent, and
    // silently pairing a real vault with a fixture memory dir (or the reverse) would write 3rd-brain
    // notes somewhere the developer is not looking.
    if (env.BISMUTH_VAULT && env.BISMUTH_MEMORY)
        return {
            vault: env.BISMUTH_VAULT,
            memory: env.BISMUTH_MEMORY,
            explicit: true,
            created: [],
        }
    if (env.BISMUTH_VAULT || env.BISMUTH_MEMORY)
        throw new Error(
            'set BOTH BISMUTH_VAULT and BISMUTH_MEMORY, or neither (neither = the example vault)',
        )

    const root = resolve(import.meta.dir, '../../.dev-vault')
    const vault = join(root, 'vault')
    // THE LIVE 3RD BRAIN IS `<vault>/.daemon/memory`, NOT AN ARBITRARY DIRECTORY. server.ts's
    // `effectiveMemoryDir()` ignores BISMUTH_MEMORY entirely and joins the vault with
    // `.daemon/memory`, gated on `settings.daemon.enabled` — so a fixture that put memory in a
    // sibling folder produced a vault whose 3rd-brain graph was permanently empty in every mode,
    // which reads as "memory is broken" rather than "memory is somewhere else". BISMUTH_MEMORY is
    // still passed to the core server because standalone/CLI paths accept it, but the graph does
    // not consult it.
    const memory = join(vault, '.daemon', 'memory')
    mkdirSync(vault, { recursive: true })
    mkdirSync(memory, { recursive: true })
    const created = [
        ...writeMissing(vault, DEV_VAULT_FILES),
        ...writeMissing(memory, DEV_MEMORY_FILES),
    ]
    return { vault, memory, explicit: false, created }
}

/** One-line banner so it is never ambiguous WHICH vault the running app is editing. */
export function describeChoice(c: VaultChoice): string {
    if (c.explicit) return `[dev] vault: ${c.vault}  (from BISMUTH_VAULT)`
    const note = c.created.length
        ? `created ${c.created.length} example file(s)`
        : 'existing example vault'
    return `[dev] vault: ${c.vault}  (${note} — rm -rf .dev-vault to reset)`
}
