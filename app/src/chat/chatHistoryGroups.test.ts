import { describe, expect, it } from 'bun:test'
import { daysAgo, groupByAge } from './chatHistoryGroups'

// A fixed local "now": 2026-10-03 15:00 local time.
const NOW = new Date(2026, 9, 3, 15, 0).getTime()
const at = (y: number, m: number, d: number, h = 12) =>
    new Date(y, m, d, h).getTime()

describe('daysAgo', () => {
    it('counts local calendar days, not 24h spans', () => {
        expect(daysAgo(at(2026, 9, 3, 0), NOW)).toBe(0)
        // 23:59 yesterday is under 24h ago but still yesterday
        expect(daysAgo(new Date(2026, 9, 2, 23, 59).getTime(), NOW)).toBe(1)
        expect(daysAgo(at(2026, 8, 26), NOW)).toBe(7)
    })
    it('treats a future timestamp as today', () => {
        expect(daysAgo(NOW + 3_600_000 * 5, NOW)).toBe(0)
    })
})

describe('groupByAge', () => {
    type S = { id: string; t: number }
    const s = (id: string, t: number): S => ({ id, t })

    it('buckets into ordered groups and omits empty ones', () => {
        const items = [
            s('a', at(2026, 9, 3, 14)),
            s('b', at(2026, 9, 2)),
            s('c', at(2026, 8, 28)),
            s('d', at(2026, 7, 1)),
        ]
        const groups = groupByAge(items, x => x.t, NOW)
        expect(groups.map(g => g.label)).toEqual([
            'today',
            'yesterday',
            'past 7 days',
            'older',
        ])
        expect(groups.map(g => g.items.map(x => x.id))).toEqual([
            ['a'],
            ['b'],
            ['c'],
            ['d'],
        ])
    })

    it('keeps the input order inside a group', () => {
        const items = [
            s('x', at(2026, 9, 3, 9)),
            s('y', at(2026, 9, 3, 13)),
            s('z', at(2026, 9, 3, 1)),
        ]
        const [today] = groupByAge(items, x => x.t, NOW)
        expect(today.items.map(x => x.id)).toEqual(['x', 'y', 'z'])
    })

    it('puts the window edges in the right bucket', () => {
        const groups = groupByAge(
            [
                s('6d', at(2026, 8, 27)),
                s('7d', at(2026, 8, 26)),
                s('29d', at(2026, 8, 4)),
                s('30d', at(2026, 8, 3)),
            ],
            x => x.t,
            NOW,
        )
        expect(
            Object.fromEntries(
                groups.map(g => [g.label, g.items.map(x => x.id)]),
            ),
        ).toEqual({
            'past 7 days': ['6d'],
            'past 30 days': ['7d', '29d'],
            older: ['30d'],
        })
    })

    it('returns nothing for no items', () => {
        expect(groupByAge([], () => 0, NOW)).toEqual([])
    })
})
