import { test, expect } from 'bun:test'
import { emptyDoc } from '../../src/drawing/model'
import {
    DEFAULT_MARGIN_RATIO,
    marginRatioOf,
    setMarginRatio,
} from '../../src/drawing/pageMargin'

test('DEFAULT_MARGIN_RATIO is 0.4 — page keeps 1/1.4 of the fit-width column', () => {
    expect(DEFAULT_MARGIN_RATIO).toBe(0.4)
})

test('marginRatioOf is 0 when the doc has no margin', () => {
    expect(marginRatioOf(emptyDoc())).toBe(0)
})

test('marginRatioOf is 0 when the doc is null', () => {
    expect(marginRatioOf(null)).toBe(0)
})

test('marginRatioOf reads margin.right', () => {
    const d = { ...emptyDoc(), margin: { right: 0.6 } }
    expect(marginRatioOf(d)).toBe(0.6)
})

test('marginRatioOf clamps to [0, 2]', () => {
    expect(marginRatioOf({ ...emptyDoc(), margin: { right: 5 } })).toBe(2)
    expect(marginRatioOf({ ...emptyDoc(), margin: { right: -3 } })).toBe(0)
})

test('marginRatioOf treats a non-finite value as absent (0), not NaN', () => {
    expect(
        marginRatioOf({ ...emptyDoc(), margin: { right: NaN } }),
    ).toBe(0)
    expect(
        marginRatioOf({ ...emptyDoc(), margin: { right: Infinity } }),
    ).toBe(0)
})

test('setMarginRatio sets margin.right', () => {
    const d = setMarginRatio(emptyDoc(), DEFAULT_MARGIN_RATIO)
    expect(d.margin).toEqual({ right: DEFAULT_MARGIN_RATIO })
})

test('setMarginRatio with ratio <= 0 removes the margin key', () => {
    const withMargin = setMarginRatio(emptyDoc(), 0.6)
    const removed = setMarginRatio(withMargin, 0)
    expect('margin' in removed).toBe(false)
    const removedNeg = setMarginRatio(withMargin, -1)
    expect('margin' in removedNeg).toBe(false)
})

test('setMarginRatio never mutates its input', () => {
    const d = emptyDoc()
    const next = setMarginRatio(d, 0.6)
    expect(d.margin).toBeUndefined()
    expect(next).not.toBe(d)
})
