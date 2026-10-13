// app/src/daemon/logDetail.ts
// Pure helpers behind an expanded daemon log row and the log's one-name filter: a stable key per
// event (so an expanded row survives the 5s re-poll that replaces every event object), the long
// timestamp and meta line the detail shows, and the filter itself. No framework imports.
import type { ActivityEvent } from '../../../core/src/daemonActivity'

/** Identity for one event across polls — the poll hands back fresh objects every time. */
export function eventKey(e: ActivityEvent): string {
    return `${e.ts}|${e.kind}|${e.name}|${e.event}|${e.outcome ?? ''}`
}

/** "Oct 12, 20:11:24" — the second-precision time the one-line row rounds away. */
export function fullTime(ts: string): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${day}, ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** "<1s" | "1.4s" | "3m 12s" — the exact duration the row's bucket hides; null without one. */
export function fullDuration(ms: number | undefined): string | null {
    if (ms === undefined) return null
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    const m = Math.floor(ms / 60000)
    const s = Math.round((ms % 60000) / 1000)
    return s === 0 ? `${m}m` : `${m}m ${s}s`
}

/** The expanded row's meta line: time // kind // duration // cause, empty parts dropped. */
export function detailMeta(e: ActivityEvent): string {
    const parts = [fullTime(e.ts), e.kind, fullDuration(e.durationMs)]
    if (e.cause) parts.push(`cause ${e.cause}`)
    return parts.filter(Boolean).join(' // ')
}

/** Events owned by `name`, order kept; a null filter passes everything through. */
export function filterEvents(
    events: ActivityEvent[],
    name: string | null,
): ActivityEvent[] {
    if (!name) return events
    return events.filter(e => e.name === name)
}
