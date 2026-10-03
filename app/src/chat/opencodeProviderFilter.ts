// The "add a provider" list's filter: name substring (case-insensitive), sorted by name, capped.
// Pure — no framework imports — so ChatAuthPanel stays I/O + markup and this stays unit-testable.
import type { OpencodeProviderList } from '../api'

export type AvailableProvider = OpencodeProviderList['available'][number]

/** Most rows the popover ever shows; the rest collapse into `+N more // keep typing`. */
export const MAX_AVAILABLE_ROWS = 8

export function filterAvailable(
    available: AvailableProvider[],
    query: string,
    max: number = MAX_AVAILABLE_ROWS,
): { shown: AvailableProvider[]; more: number } {
    const q = query.trim().toLowerCase()
    const matches = available
        .filter(p => p.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
    return { shown: matches.slice(0, max), more: Math.max(0, matches.length - max) }
}
