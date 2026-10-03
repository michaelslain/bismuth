// app/src/chat/chatHistoryGroups.ts
// Buckets the history panel's sessions under lowercase age labels ("today", "yesterday", …) so
// the resume list reads as a timeline instead of one undifferentiated run. Pure — no DOM, no
// framework — so the bucketing is unit-tested without mounting ChatHistoryPanel.
//
// The windows are ROLLING day counts from the local calendar day of `now`, not calendar weeks or
// months: "past 7 days" on a Monday still holds last Thursday. The labels say "past", never
// "this week", because a calendar label over a rolling window would be wrong half the time.

export type AgeGroup<T> = { label: string; items: T[] }

const BUCKETS: { label: string; maxDays: number }[] = [
    { label: 'today', maxDays: 0 },
    { label: 'yesterday', maxDays: 1 },
    { label: 'past 7 days', maxDays: 6 },
    { label: 'past 30 days', maxDays: 29 },
    { label: 'older', maxDays: Infinity },
]

/** Whole local calendar days between `ms` and `now` (0 = same day). Built from y/m/d rather than
 *  dividing a millisecond span, so a DST shift inside the span cannot push a row a day over. A
 *  timestamp in the future (clock skew) counts as today. */
export function daysAgo(ms: number, now: number): number {
    const a = new Date(ms)
    const b = new Date(now)
    const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
    const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
    return Math.max(0, Math.round((dayB - dayA) / 86_400_000))
}

/** Splits `items` into age groups in fixed order (today → older), omitting empty groups and
 *  keeping each item's original relative order inside its group. */
export function groupByAge<T>(
    items: readonly T[],
    timeOf: (item: T) => number,
    now: number,
): AgeGroup<T>[] {
    const groups = BUCKETS.map(b => ({ label: b.label, items: [] as T[] }))
    for (const item of items) {
        const d = daysAgo(timeOf(item), now)
        const i = BUCKETS.findIndex(b => d <= b.maxDays)
        groups[i].items.push(item)
    }
    return groups.filter(g => g.items.length > 0)
}
