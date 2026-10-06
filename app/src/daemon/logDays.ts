// app/src/daemon/logDays.ts
// Groups a newest-first activity list under local-calendar-day labels for the opened log:
// `today`, `yesterday`, else a short date (`Oct 3`). Order is preserved; no framework imports.
import type { ActivityEvent } from '../../../core/src/daemonActivity'

const dayStart = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

const DAY = 24 * 60 * 60 * 1000

export function groupByDay(
    events: ActivityEvent[],
    now: Date,
): { label: string; events: ActivityEvent[] }[] {
    const today = dayStart(now)
    const groups: { key: number; label: string; events: ActivityEvent[] }[] = []
    for (const e of events) {
        const when = new Date(e.ts)
        const key = dayStart(when)
        let g = groups[groups.length - 1]
        if (!g || g.key !== key) {
            const diff = Math.round((today - key) / DAY)
            const label =
                diff === 0
                    ? 'today'
                    : diff === 1
                      ? 'yesterday'
                      : when.toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                        })
            g = { key, label, events: [] }
            groups.push(g)
        }
        g.events.push(e)
    }
    return groups.map(({ label, events }) => ({ label, events }))
}

/** `HH:MM` (24h, zero-padded, local) for the opened log's time cell. */
export function clockTime(ts: string): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}`
}
