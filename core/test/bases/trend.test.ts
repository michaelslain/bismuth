import { describe, expect, test } from 'bun:test'
import { fitTrend, trendAt } from '../../src/bases/trend'

describe('fitTrend', () => {
    test('perfect line: exact slope/intercept, r2 = 1', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 1 },
            { key: '2026-06-08', label: 'Jun 8', value: 3 },
            { key: '2026-06-15', label: 'Jun 15', value: 5 },
            { key: '2026-06-22', label: 'Jun 22', value: 7 },
        ]
        const fit = fitTrend(points, { isDate: true, bin: 'week' })
        expect(fit).not.toBeNull()
        expect(fit!.slope).toBeCloseTo(2, 10)
        expect(fit!.intercept).toBeCloseTo(1, 10)
        expect(fit!.r2).toBeCloseTo(1, 10)
        expect(fit!.origin).toBe('Jun 1')
        expect(fit!.unit).toBe('week')
    })

    test('flat line: r2 = 1, never NaN', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 4 },
            { key: '2026-06-08', label: 'Jun 8', value: 4 },
            { key: '2026-06-15', label: 'Jun 15', value: 4 },
        ]
        const fit = fitTrend(points, { isDate: true, bin: 'week' })
        expect(fit).not.toBeNull()
        expect(fit!.slope).toBeCloseTo(0, 10)
        expect(fit!.intercept).toBeCloseTo(4, 10)
        expect(fit!.r2).toBe(1)
        expect(Number.isNaN(fit!.r2)).toBe(false)
    })

    test('noisy data: 0 < r2 < 1', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 1 },
            { key: '2026-06-08', label: 'Jun 8', value: 5 },
            { key: '2026-06-15', label: 'Jun 15', value: 2 },
            { key: '2026-06-22', label: 'Jun 22', value: 8 },
            { key: '2026-06-29', label: 'Jun 29', value: 4 },
        ]
        const fit = fitTrend(points, { isDate: true, bin: 'week' })
        expect(fit).not.toBeNull()
        expect(fit!.r2).toBeGreaterThan(0)
        expect(fit!.r2).toBeLessThan(1)
    })

    test('fewer than 3 points returns null', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 1 },
            { key: '2026-06-08', label: 'Jun 8', value: 3 },
        ]
        expect(fitTrend(points, { isDate: true, bin: 'week' })).toBeNull()
    })

    test('category axis (isDate false) returns null', () => {
        const points = [
            { key: 'a', label: 'a', value: 1 },
            { key: 'b', label: 'b', value: 2 },
            { key: 'c', label: 'c', value: 3 },
        ]
        expect(fitTrend(points, { isDate: false, bin: 'day' })).toBeNull()
    })

    test('zero variance in t returns null', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 1 },
            { key: '2026-06-01', label: 'Jun 1', value: 2 },
            { key: '2026-06-01', label: 'Jun 1', value: 3 },
        ]
        expect(fitTrend(points, { isDate: true, bin: 'day' })).toBeNull()
    })

    test('day bin uses day difference as t', () => {
        const points = [
            { key: '2026-06-01', label: 'Jun 1', value: 1 },
            { key: '2026-06-02', label: 'Jun 2', value: 2 },
            { key: '2026-06-03', label: 'Jun 3', value: 3 },
        ]
        const fit = fitTrend(points, { isDate: true, bin: 'day' })
        expect(fit!.slope).toBeCloseTo(1, 10)
        expect(fit!.unit).toBe('day')
    })

    test('month bin uses month difference as t', () => {
        const points = [
            { key: '2026-01-01', label: 'Jan 2026', value: 1 },
            { key: '2026-02-01', label: 'Feb 2026', value: 2 },
            { key: '2026-03-01', label: 'Mar 2026', value: 3 },
        ]
        const fit = fitTrend(points, { isDate: true, bin: 'month' })
        expect(fit!.slope).toBeCloseTo(1, 10)
        expect(fit!.unit).toBe('month')
    })
})

describe('trendAt', () => {
    test('evaluates the line at t', () => {
        const fit = { slope: 2, intercept: 1, r2: 1, unit: 'week' as const, origin: 'Jun 1' }
        expect(trendAt(fit, 0)).toBe(1)
        expect(trendAt(fit, 3)).toBe(7)
    })
})
