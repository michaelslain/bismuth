import { expect, test } from 'bun:test'
import { clockTime, groupByDay } from './logDays'

const now = new Date('2026-10-05T16:00:00')
const ev = (ts: string) => ({ ts, kind: 'cron', name: 'x', event: 'finished' })

test('groups newest-first events under today / yesterday / a short date', () => {
    const g = groupByDay(
        [ev('2026-10-05T15:00:00'), ev('2026-10-05T09:00:00'), ev('2026-10-04T20:00:00'), ev('2026-10-02T08:00:00')],
        now,
    )
    expect(g.map(d => d.label)).toEqual(['today', 'yesterday', 'Oct 2'])
    expect(g[0].events).toHaveLength(2)
})
test('empty in, empty out', () => {
    expect(groupByDay([], now)).toEqual([])
})
test('clockTime is zero-padded 24h local', () => {
    expect(clockTime('2026-10-04T08:05:00')).toBe('08:05')
    expect(clockTime('2026-10-04T23:59:00')).toBe('23:59')
})
