import { describe, expect, test } from 'bun:test'
import { estimateHeight, indexAt, offsetOf, planWindow } from './transcriptDocWindow'

const base = { count: 300, heights: [] as (number | undefined)[], estimate: () => 100, viewport: 500, overscan: 200 }

describe('planWindow', () => {
    test('mounts the first sections at the top', () => {
        const p = planWindow({ ...base, scrollTop: 0 })
        expect(p.from).toBe(0)
        expect(p.to).toBe(7)
        expect(p.tops[300]).toBe(30000)
    })
    test('mounts around a deep scroll position', () => {
        const p = planWindow({ ...base, scrollTop: 27950 })
        expect(p.from).toBe(277)
        expect(p.to).toBe(287)
    })
    test('measured heights replace the estimate', () => {
        const heights = [400, 400]
        const p = planWindow({ ...base, heights, scrollTop: 0 })
        expect(p.tops.slice(0, 3)).toEqual([0, 400, 800])
        expect(p.to).toBe(2)
    })
    test('always mounts at least one section, and none for an empty doc', () => {
        expect(planWindow({ ...base, scrollTop: 999999 }).to - planWindow({ ...base, scrollTop: 999999 }).from).toBeGreaterThanOrEqual(1)
        const e = planWindow({ ...base, count: 0, scrollTop: 0 })
        expect(e.from).toBe(0)
        expect(e.to).toBe(0)
    })
})

describe('indexAt / offsetOf', () => {
    const tops = [0, 100, 300, 400]
    test('finds the section and fraction', () => {
        expect(indexAt(tops, 0)).toEqual({ index: 0, frac: 0 })
        expect(indexAt(tops, 200)).toEqual({ index: 1, frac: 0.5 })
        expect(indexAt(tops, 399).index).toBe(2)
        expect(indexAt(tops, 9999).index).toBe(2)
    })
    test('offsetOf inverts indexAt', () => {
        expect(offsetOf(tops, 1, 0.5)).toBe(200)
        expect(offsetOf(tops, 9, 0)).toBe(300)
    })
})

describe('estimateHeight', () => {
    const o = { divider: 30, line: 20, charsPerLine: 50, min: 40 }
    test('empty text keeps the minimum', () => expect(estimateHeight('', o)).toBe(70))
    test('wraps long lines', () => expect(estimateHeight('x'.repeat(120), o)).toBe(30 + 60))
})
