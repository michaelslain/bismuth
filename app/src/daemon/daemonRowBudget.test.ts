import { test, expect } from 'bun:test'
import { allocateRows, rowUnits } from './daemonRowBudget'

const need = (total: number, floor = 3) => ({ total, floor })

test('everything fits: no section is limited', () => {
    expect(allocateRows(20, [need(2), need(3), need(2), need(12)])).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
    ])
})

test('exactly fits: still no limits', () => {
    expect(allocateRows(19, [need(2), need(3), need(2), need(12)])).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
    ])
})

test('a long log is cut, short sections keep every row', () => {
    // 2 + 3 + 2 = 7 rows fit whole; 10 units left → log shows 9 + its more-line.
    expect(allocateRows(17, [need(2), need(3), need(2), need(60)])).toEqual([
        undefined,
        undefined,
        undefined,
        9,
    ])
})

test('the budget used never exceeds what is available once the floors fit, more-lines included', () => {
    const needs = [need(9), need(14), need(6), need(60)]
    for (const available of [16, 20, 27, 40]) {
        const limits = allocateRows(available, needs)
        const used = limits.reduce<number>(
            (a, l, i) => a + (l === undefined ? needs[i].total : l + 1),
            0,
        )
        expect(used).toBeLessThanOrEqual(available)
    }
})

test('leftover rows go round-robin, not all to the biggest section', () => {
    // floors 3 each + 4 more-lines = 16; 8 spare units → 2 each.
    expect(allocateRows(24, [need(20), need(20), need(20), need(20)])).toEqual([
        5, 5, 5, 5,
    ])
})

test('the floor is kept even when the budget is too small', () => {
    expect(allocateRows(4, [need(10), need(10), need(10), need(10)])).toEqual([
        3, 3, 3, 3,
    ])
})

test('an attention floor above the default is never cut into', () => {
    const limits = allocateRows(10, [need(12, 7), need(10), need(10), need(40)])
    expect(limits[0]).toBe(7)
})

test('growing to the last hidden row frees the more-line instead of costing a row', () => {
    // floor 3 of 4 + more-line = 4 units; available 4 → showing all 4 costs the same.
    expect(allocateRows(4, [need(4)])).toEqual([undefined])
})

test('an empty section needs nothing and is never limited', () => {
    expect(allocateRows(6, [need(0), need(10), need(0), need(0)])).toEqual([
        undefined,
        5,
        undefined,
        undefined,
    ])
})

test('rowUnits floors and never goes negative', () => {
    expect(rowUnits(500, 100, 22)).toBe(18)
    expect(rowUnits(50, 100, 22)).toBe(0)
    expect(rowUnits(500, 100, 0)).toBe(0)
})
