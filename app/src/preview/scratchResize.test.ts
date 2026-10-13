import { describe, expect, test } from 'bun:test'
import { DEFAULT_MARGIN_RATIO, MAX_MARGIN_RATIO } from '../../../core/src/drawing/pageMargin'
import { SNAP_DISTANCE } from '../edgeResize'
import { MIN_MARGIN_RATIO, dragMarginRatio, fixedUnitLine } from './scratchResize'

// A 1000px PDF unit at the default ratio: page 714.29, strip 285.71.
const PAGE = 1000 / 1.4
const pdfLine = fixedUnitLine(PAGE, 1000 - PAGE)

// An image held at its natural 200px width, its unit centred on x = 500: the line sits at
// 500 - (200 + 200r) / 2 + 200, so it moves half as far as the strip grows.
const imageLine = (r: number) => 500 - (200 * (1 + r)) / 2 + 200

describe('dragMarginRatio', () => {
    test('dragging the line left widens the strip, right narrows it', () => {
        expect(dragMarginRatio(pdfLine, PAGE, -100)).toBeGreaterThan(DEFAULT_MARGIN_RATIO)
        expect(dragMarginRatio(pdfLine, PAGE, 100)).toBeLessThan(DEFAULT_MARGIN_RATIO)
    })
    test('the line follows the pointer on a fixed-width PDF unit', () => {
        const r = dragMarginRatio(pdfLine, PAGE, -200)
        expect(pdfLine(r)).toBeCloseTo(PAGE - 200, 0)
    })
    test('the line follows the pointer on a re-centring image unit', () => {
        const start = imageLine(DEFAULT_MARGIN_RATIO)
        const r = dragMarginRatio(imageLine, start, -80)
        expect(imageLine(r)).toBeCloseTo(start - 80, 0)
    })
    test('clamps to the ratio range', () => {
        expect(dragMarginRatio(pdfLine, PAGE, -5000)).toBe(MAX_MARGIN_RATIO)
        expect(dragMarginRatio(pdfLine, PAGE, 5000)).toBe(MIN_MARGIN_RATIO)
    })
    test('snaps onto the default within SNAP_DISTANCE of its line', () => {
        const from = pdfLine(1)
        const toDefault = PAGE - from
        expect(dragMarginRatio(pdfLine, from, toDefault - SNAP_DISTANCE)).toBe(
            DEFAULT_MARGIN_RATIO,
        )
        expect(dragMarginRatio(pdfLine, from, toDefault - SNAP_DISTANCE - 2)).not.toBe(
            DEFAULT_MARGIN_RATIO,
        )
    })
    test('rounds to 3 decimals', () => {
        const r = dragMarginRatio(pdfLine, PAGE, -137)
        expect(r).toBe(Math.round(r * 1000) / 1000)
    })
})
