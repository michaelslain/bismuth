// The brain block: the bounded orientation text (profile, vault map, memory index) an agent session
// starts with, composed per channel and cached per vault until the vault or memory changes.
import {
    MEMORY_BANNER,
    MEMORY_BLOCK_TAG,
    defang,
    formatProfile,
    formatSessionStart,
    isMemoryNoteVisibleToDaemon,
    loadAllNotes,
} from '@bismuth/memory'
import type { MemoryNote } from '@bismuth/memory'
import { resolve } from 'node:path'
import { buildVaultMap, formatVaultMap } from './vaultMap'
import type { VaultMap } from './vaultMap'
import { buildDenyPaths } from './visibility'
import type { DenyEntry } from './visibility'

export type BrainChannel = 'chat' | 'daemon'

export const BRAIN_BUDGET_CHARS = 9500
const MAP_BUDGET_CHARS = 2200
const PROFILE_BUDGET_CHARS = 1500
const DEFAULT_WAIT_MS = 1000
// A map older than this rebuilds even if nothing called invalidateBrain (long-lived processes).
export const MAP_MAX_AGE_MS = 5 * 60 * 1000

export type BrainOpts = {
    vaultDir: string
    memoryDir: string | null
    channel: BrainChannel
    budgetChars?: number
    waitMs?: number
}

export type BrainDeps = {
    buildMap: (root: string, opts: { deny: DenyEntry[] }) => Promise<VaultMap>
    formatMap: (map: VaultMap, budgetChars: number) => string
    denyFor: (vaultDir: string, channel: BrainChannel) => Promise<DenyEntry[]>
    loadNotes: (memoryDir: string) => Promise<MemoryNote[]>
    formatProfile?: typeof formatProfile
    formatSessionStart?: typeof formatSessionStart
    now?: () => number
}

type Entry = { map?: VaultMap; builtAt?: number; pending?: Promise<VaultMap | null> }

export function createBrainComposer(deps: BrainDeps) {
    const cache = new Map<string, Entry>()
    // Bumped by invalidate so a build that started before it never writes its stale map back.
    const generations = new Map<string, number>()
    const now = deps.now ?? Date.now
    const keyOf = (vaultDir: string, channel: BrainChannel) => `${resolve(vaultDir)}\0${channel}`
    const generation = (vaultDir: string) => generations.get(resolve(vaultDir)) ?? 0

    function mapFor(vaultDir: string, channel: BrainChannel, waitMs: number): Promise<VaultMap | null> {
        const key = keyOf(vaultDir, channel)
        let entry = cache.get(key)
        if (entry?.map && now() - (entry.builtAt ?? 0) > MAP_MAX_AGE_MS) {
            entry.map = undefined
            entry.builtAt = undefined
        }
        if (entry?.map) return Promise.resolve(entry.map)
        if (!entry) {
            entry = {}
            cache.set(key, entry)
        }
        if (!entry.pending) {
            const gen = generation(vaultDir)
            const live = entry
            live.pending = (async () => {
                const deny = await deps.denyFor(vaultDir, channel)
                const map = await deps.buildMap(vaultDir, { deny })
                if (generation(vaultDir) === gen && cache.get(key) === live) {
                    live.map = map
                    live.builtAt = now()
                }
                return map
            })()
                .catch(() => null)
                .finally(() => {
                    if (live.pending) live.pending = undefined
                })
        }
        const pending = entry.pending as Promise<VaultMap | null>
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<null>(r => {
            timer = setTimeout(() => r(null), waitMs)
        })
        return Promise.race([pending, timeout]).finally(() => clearTimeout(timer))
    }

    async function composeBrain(opts: BrainOpts): Promise<string | null> {
        const budget = opts.budgetChars ?? BRAIN_BUDGET_CHARS
        const map = await mapFor(opts.vaultDir, opts.channel, opts.waitMs ?? DEFAULT_WAIT_MS)

        let notes: MemoryNote[] = []
        if (opts.memoryDir) {
            try {
                notes = (await deps.loadNotes(opts.memoryDir)).filter(isMemoryNoteVisibleToDaemon)
            } catch {
                notes = []
            }
        }

        const sections: string[] = []
        const profile = notes.length ? (deps.formatProfile ?? formatProfile)(notes, PROFILE_BUDGET_CHARS) : null
        if (profile) sections.push(`# Who you are working with\n\n${profile.trim()}`)
        if (map && map.notes > 0) {
            const header = `# Vault map (${map.notes} notes)\n\n`
            // formatMap opens with its own title line; the brain's header already says it.
            const text = deps
                .formatMap(map, MAP_BUDGET_CHARS - header.length)
                .replace(/^\s*# [^\n]*\n/, '')
                .trim()
            if (text) sections.push(header + text)
        }
        const lead = sections.length ? `${sections.join('\n\n')}\n` : undefined

        const fmt = deps.formatSessionStart ?? formatSessionStart
        const profileLead = profile ? `# Who you are working with\n\n${profile.trim()}\n` : undefined
        const leads = [lead, profileLead && profileLead !== lead ? profileLead : undefined, undefined].filter(
            (l, i, all) => i === all.length - 1 || l !== undefined,
        )
        for (const l of leads) {
            const full = fmt(notes, { budgetChars: budget, ...(l ? { lead: l } : {}) })
            if (!full) break // no notes: every lead variant yields null
            if (full.length <= budget) return full
        }
        if (!lead) return null
        // Nothing fit with the index: the lead alone, cut at a line boundary, always closed.
        const open = `<${MEMORY_BLOCK_TAG}>\n${MEMORY_BANNER}\n\n`
        const close = `</${MEMORY_BLOCK_TAG}>`
        const room = Math.max(0, budget - open.length - close.length - 1)
        let cut = lead.slice(0, room)
        if (lead.length > room) cut = cut.slice(0, Math.max(0, cut.lastIndexOf('\n')))
        return `${open}${defang(cut.trimEnd())}\n${close}`
    }

    function invalidateBrain(vaultDir: string): void {
        const dir = resolve(vaultDir)
        generations.set(dir, generation(dir) + 1)
        for (const channel of ['chat', 'daemon'] as const) cache.delete(keyOf(dir, channel))
    }

    return { composeBrain, invalidateBrain }
}

const shared = createBrainComposer({
    buildMap: (root, o) => buildVaultMap(root, o),
    formatMap: formatVaultMap,
    denyFor: (vaultDir, channel) => buildDenyPaths(vaultDir, channel),
    loadNotes: dir => loadAllNotes(dir),
})

export const composeBrain: (opts: BrainOpts) => Promise<string | null> = shared.composeBrain
export const invalidateBrain: (vaultDir: string) => void = shared.invalidateBrain
