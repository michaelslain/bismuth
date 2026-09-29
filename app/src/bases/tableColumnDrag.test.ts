import { describe, expect, test } from 'bun:test'
import {
    columnAtX,
    moveColumn,
    resizeTarget,
    resizedWidths,
    seedWidths,
} from './tableColumnDrag'

const rects = [
    { left: 0, right: 100 },
    { left: 100, right: 220 },
    { left: 220, right: 300 },
]

describe('columnAtX', () => {
    test('finds the header under the pointer', () => {
        expect(columnAtX(rects, 50)).toBe(0)
        expect(columnAtX(rects, 150)).toBe(1)
        expect(columnAtX(rects, 299)).toBe(2)
    })
    test('null outside every header', () => {
        expect(columnAtX(rects, -5)).toBeNull()
        expect(columnAtX(rects, 400)).toBeNull()
    })
})

describe('moveColumn', () => {
    test('moves a column to the target slot', () => {
        expect(moveColumn(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a'])
        expect(moveColumn(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    })
    test('null when nothing moves', () => {
        expect(moveColumn(['a', 'b'], 1, 1)).toBeNull()
        expect(moveColumn(['a', 'b'], 0, null)).toBeNull()
    })
    test('does not mutate the input', () => {
        const cols = ['a', 'b', 'c']
        moveColumn(cols, 0, 2)
        expect(cols).toEqual(['a', 'b', 'c'])
    })
})

describe('resizeTarget', () => {
    const rect = { left: 100, right: 220 }
    test('right edge resizes this column', () => {
        expect(resizeTarget(1, rect, 215, 10, true)).toBe(1)
    })
    test('left edge resizes the previous column', () => {
        expect(resizeTarget(1, rect, 104, 10, true)).toBe(0)
    })
    test('left edge of the first column resizes nothing', () => {
        expect(resizeTarget(0, { left: 0, right: 100 }, 3, 10, true)).toBeNull()
    })
    test('middle of the header is not a resize zone', () => {
        expect(resizeTarget(1, rect, 160, 10, true)).toBeNull()
    })
    test('null when resizing is not enabled', () => {
        expect(resizeTarget(1, rect, 215, 10, false)).toBeNull()
    })
})

describe('seedWidths', () => {
    test('keeps stored widths and fills the rest from measured ones', () => {
        expect(seedWidths(['a', 'b', 'c'], { b: 50 }, [10, 20, 30])).toEqual({
            a: 10,
            b: 50,
            c: 30,
        })
    })
    test('skips a column with no measurement', () => {
        expect(seedWidths(['a', 'b'], {}, [10])).toEqual({ a: 10 })
    })
})

describe('resizedWidths', () => {
    test('grows the dragged column only', () => {
        expect(resizedWidths({ a: 100, b: 100 }, 'a', 100, 0, 40, 60)).toEqual({
            a: 140,
            b: 100,
        })
    })
    test('clamps to the minimum width', () => {
        expect(resizedWidths({ a: 100 }, 'a', 100, 0, -500, 60)).toEqual({
            a: 60,
        })
    })
    test('rounds to whole pixels', () => {
        expect(resizedWidths({ a: 100 }, 'a', 100, 0, 10.6, 60).a).toBe(111)
    })
})
