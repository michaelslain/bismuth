// The "add a provider" list's filter: name substring (case-insensitive), capped. A typed query sorts
// by name; an empty one leads with POPULAR_PROVIDER_IDS, then the rest by name.
// Pure — no framework imports — so ChatAuthPanel stays I/O + markup and this stays unit-testable.
import type { OpencodeProviderList } from '../api'

export type AvailableProvider = OpencodeProviderList['available'][number]

/** Most rows the popover ever shows; the rest collapse into `+N more // keep typing`. */
export const MAX_AVAILABLE_ROWS = 8

/** The providers an empty query leads with, in this order, when they are present. */
export const POPULAR_PROVIDER_IDS = [
    'anthropic',
    'openai',
    'openrouter',
    'github-copilot',
    'google',
    'groq',
    'xai',
    'deepseek',
]

export function filterAvailable(
    available: AvailableProvider[],
    query: string,
    max: number = MAX_AVAILABLE_ROWS,
): { shown: AvailableProvider[]; more: number } {
    const q = query.trim().toLowerCase()
    const byName = (a: AvailableProvider, b: AvailableProvider) =>
        a.name.localeCompare(b.name)
    const rank = (p: AvailableProvider) => POPULAR_PROVIDER_IDS.indexOf(p.id)
    const matches = available
        .filter(p => p.name.toLowerCase().includes(q))
        // A typed query is a search, sorted by name; an empty one leads with the popular head.
        .sort((a, b) => {
            if (q) return byName(a, b)
            const ra = rank(a)
            const rb = rank(b)
            if (ra >= 0 && rb >= 0) return ra - rb
            return ra >= 0 ? -1 : rb >= 0 ? 1 : byName(a, b)
        })
    return { shown: matches.slice(0, max), more: Math.max(0, matches.length - max) }
}
