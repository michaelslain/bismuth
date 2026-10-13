// {{brainReport}} — the health report of a vault's memory graph, substituted into any cron prompt
// that carries the placeholder (the seeded dream uses it as its agenda). It is computed by the
// daemon, not by the model: the model used to run a Bash size/cluster survey every hour; now it
// reads a ranked list and works it worst first.
import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
    brainHealth,
    type BrainHealthItem,
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

/** The report as the prompt shows it, plus `key`: a fingerprint of every item in it (shown or
 *  not), or null when the graph is healthy or the report is unavailable. The incremental gate
 *  compares the key with the one the previous run started from (see cron.ts's fireJob). */
export type BrainAgenda = { text: string; key: string | null }

/** Fingerprint of an agenda's items; null for an empty agenda. Pure. */
export function agendaKey(items: readonly BrainHealthItem[]): string | null {
    if (items.length === 0) return null
    return createHash('sha256').update(JSON.stringify(items)).digest('hex').slice(0, 16)
}

/** The formatted health report and its agenda key. Never throws: a failure is one
 *  `brain report unavailable: <reason>` line with a null key. */
export async function resolveBrainAgenda(
    ctx: VaultContext,
    deps: BrainReportDeps = {},
): Promise<BrainAgenda> {
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
        const h = health(visible, { vaultNames: new Set([...vaultNames, ...hiddenNames]) })
        return { text: format(h), key: agendaKey(h.items) }
    } catch (e) {
        const reason = (e instanceof Error ? e.message : String(e))
            .replace(/\s+/g, ' ')
            .trim()
        return { text: `brain report unavailable: ${reason}`, key: null }
    }
}

/** Put an already-resolved report into the prompt's placeholder. Pure. */
export function substituteBrainReport(prompt: string, report: string): string {
    return prompt.split(BRAIN_REPORT_PLACEHOLDER).join(report)
}
