import { describe, expect, test } from 'bun:test'
import { railShifts } from './tabRailShift'

describe('railShifts', () => {
    test('a row dragged down moves to the drop slot and the rows it passes move up one', () => {
        expect(
            railShifts(['a', 'b', 'c', 'd'], ['b', 'c', 'a', 'd'], 20),
        ).toEqual([40, -20, -20, 0])
    })
    test('a row dragged up moves to the drop slot and the rows it passes move down one', () => {
        expect(
            railShifts(['a', 'b', 'c', 'd'], ['a', 'd', 'b', 'c'], 20),
        ).toEqual([0, 20, 20, -40])
    })
    test('an unchanged order shifts nothing', () => {
        expect(railShifts(['a', 'b'], ['a', 'b'], 20)).toEqual([0, 0])
    })
    test('a row missing from the next order stays put', () => {
        expect(railShifts(['a', 'b'], ['b'], 20)).toEqual([0, -20])
    })
})
