// app/src/daemon/memoryListModel.ts
// Pure helpers behind DaemonMemory.tsx / MemoryRow.tsx — the empty-state message a search can
// land on, and a deterministic relative age — so both are unit-testable without mounting Solid
// or reading the wall clock. No Solid imports; see memoryListModel.test.ts.

/**
 * What the panel says when there is nothing to list, or `null` when there is something to show.
 * A blank/whitespace-only query counts as "no query" — it reads as "nothing remembered yet", not
 * as a quoted empty-string match.
 */
export function memoryEmptyMessage(
    query: string,
    count: number,
): string | null {
    if (count > 0) return null
    const q = query.trim()
    return q ? `no memory matches "${q}"` : 'nothing remembered yet'
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * "Ns/Nm/Nh/Nd ago" from an ISO timestamp, relative to an explicit `nowMs` — the same s → m → h →
 * d chained-rounding ladder as relTime.ts's relTimeISO, restated here with an injectable clock so
 * a test never depends on Date.now(). An empty/unparseable timestamp echoes back the same
 * fallbacks relTimeISO uses (`relTime.ts`).
 *
 * A date-only value (`memory/src/dates.ts`'s `todayISO()` → `YYYY-MM-DD`, what the real memory
 * API returns) is a LOCAL calendar date, not a UTC instant — `Date.parse` reads it as UTC
 * midnight, which misreads a note updated a minute ago as "17h ago" or "0s ago" depending on the
 * viewer's timezone. Handle that case at day granularity against the local date of `nowMs`.
 */
export function memoryAge(updatedIso: string, nowMs: number): string {
    if (!updatedIso) return 'never seen'
    if (DATE_ONLY.test(updatedIso)) {
        const [y, m, d] = updatedIso.split('-').map(Number)
        const now = new Date(nowMs)
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
        const startOfThat = new Date(y, m - 1, d).getTime()
        const dayDiff = Math.round((startOfToday - startOfThat) / 86400000)
        if (dayDiff <= 0) return 'today'
        if (dayDiff === 1) return 'yesterday'
        return `${dayDiff}d ago`
    }
    const t = Date.parse(updatedIso)
    if (Number.isNaN(t)) return updatedIso
    const diffMs = Math.max(0, nowMs - t)
    const secs = Math.round(diffMs / 1000)
    if (secs < 60) return `${secs}s ago`
    const mins = Math.round(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.round(hours / 24)}d ago`
}
