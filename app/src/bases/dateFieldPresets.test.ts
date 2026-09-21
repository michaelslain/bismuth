import { describe, expect, test } from 'bun:test'
import { dateFieldPresets } from './dateFieldPresets'

describe('dateFieldPresets', () => {
    test('today, tomorrow and next week in local ISO form', () => {
        const p = dateFieldPresets(new Date(2026, 0, 31, 23, 30))
        expect(p.map(o => o.date)).toEqual(['2026-01-31', '2026-02-01', '2026-02-07'])
        expect(p.map(o => o.label)).toEqual(['Today', 'Tomorrow', 'Next week'])
    })
})
