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

/**
 * "Ns/Nm/Nh/Nd ago" from an ISO timestamp, relative to an explicit `nowMs` — the same s → m → h →
 * d chained-rounding ladder as relTime.ts's relTimeISO, restated here with an injectable clock so
 * a test never depends on Date.now(). An empty/unparseable timestamp echoes back the same
 * fallbacks relTimeISO uses (`relTime.ts`).
 */
export function memoryAge(updatedIso: string, nowMs: number): string {
    if (!updatedIso) return 'never seen'
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
