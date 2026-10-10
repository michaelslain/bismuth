// {{brainReport}} — the health report of a vault's memory graph, substituted into any cron prompt
// that carries the placeholder (the seeded dream uses it as its agenda). It is computed by the
// daemon, not by the model: the model used to run a Bash size/cluster survey every hour; now it
// reads a ranked list and works it worst first.
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
    brainHealth,
    formatBrainHealth,
    isMemoryNoteVisibleToDaemon,
    loadAllNotes,
} from '@bismuth/memory'
import type { VaultContext } from '../lib/config.ts'

export const BRAIN_REPORT_PLACEHOLDER = '{{brainReport}}'

/** Basenames (no `.md`) of the vault's markdown notes, dot-entries skipped. Includes notes the
 *  daemon channel may not see, so links to them resolve; the names are never printed. */
async function vaultBasenames(ctx: VaultContext): Promise<Set<string>> {
    // Denied notes still count as names that resolve (a memory link to one is real provenance, not
    // a broken link); the set is only ever used for resolution and is never printed.
    const names = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
            if (e.name.startsWith('.')) continue
            const abs = join(dir, e.name)
            if (e.isDirectory()) await walk(abs)
            else if (e.name.endsWith('.md')) names.add(basename(e.name, '.md'))
        }
    }
    await walk(ctx.root)
    return names
}

/** The pieces of the report; tests pass fakes, callers use the real ones by default. */
export type BrainReportDeps = {
    loadNotes?: typeof loadAllNotes
    health?: typeof brainHealth
    format?: typeof formatBrainHealth
}

/** The formatted health report, or one `brain report unavailable: <reason>` line. Never throws. */
export async function resolveBrainReport(
    ctx: VaultContext,
    deps: BrainReportDeps = {},
): Promise<string> {
    const { loadNotes = loadAllNotes, health = brainHealth, format = formatBrainHealth } = deps
    try {
        const [all, vaultNames] = await Promise.all([
            loadNotes(ctx.memoryDir),
            vaultBasenames(ctx),
        ])
        // A hidden / chat-only memory note must not reach the daemon channel: drop it from the
        // report, but keep its name known so links to it are not reported as broken.
        const visible = all.filter(isMemoryNoteVisibleToDaemon)
        const hiddenNames = all.filter(n => !isMemoryNoteVisibleToDaemon(n)).map(n => n.name)
        return format(health(visible, { vaultNames: new Set([...vaultNames, ...hiddenNames]) }))
    } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e))
            .replace(/\s+/g, ' ')
            .trim()
        return `brain report unavailable: ${reason}`
    }
}

/** Replace the placeholder when the prompt carries it; a prompt without it is returned as is. */
export async function applyBrainReport(
    ctx: VaultContext,
    prompt: string,
    deps: BrainReportDeps = {},
): Promise<string> {
    if (!prompt.includes(BRAIN_REPORT_PLACEHOLDER)) return prompt
    const report = await resolveBrainReport(ctx, deps)
    return prompt.split(BRAIN_REPORT_PLACEHOLDER).join(report)
}
