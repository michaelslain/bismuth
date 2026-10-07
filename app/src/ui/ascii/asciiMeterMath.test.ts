import { describe, it, expect } from 'bun:test'
import {
    chartFill,
    chartLabelPad,
    chartMax,
    chartValueWidth,
    fitMeterWidth,
    meterFill,
} from './asciiMeterMath'

describe('meterFill', () => {
    it('is empty at value 0', () => {
        expect(meterFill(0, 10)).toBe(0)
    })
    it('is full at value 1', () => {
        expect(meterFill(1, 10)).toBe(10)
    })
    it('rounds a mid value to the nearest cell', () => {
        expect(meterFill(0.5, 10)).toBe(5)
        expect(meterFill(0.55, 10)).toBe(6) // rounds up
    })
    it('clamps a negative value to 0', () => {
        expect(meterFill(-0.4, 10)).toBe(0)
    })
    it('clamps a value above 1 to the full width', () => {
        expect(meterFill(1.4, 10)).toBe(10)
    })
    it('handles a zero width', () => {
        expect(meterFill(0.5, 0)).toBe(0)
    })
    it('scales with an arbitrary width', () => {
        expect(meterFill(0.25, 20)).toBe(5)
        expect(meterFill(0.75, 4)).toBe(3)
    })
    it('a non-zero value never reads as empty: it floors at one cell', () => {
        expect(meterFill(0.04, 10)).toBe(1) // 0.4 rounds to 0
        expect(meterFill(0.001, 10)).toBe(1)
        expect(meterFill(0.04, 10)).toBeGreaterThan(meterFill(0, 10))
    })
    it('still leaves zero and below empty, and a zero width empty', () => {
        expect(meterFill(0, 10)).toBe(0)
        expect(meterFill(-0.001, 10)).toBe(0)
        expect(meterFill(0.3, 0)).toBe(0)
    })
})

describe('chartMax', () => {
    it('bottoms out at 1 for an empty series', () => {
        expect(chartMax([])).toBe(1)
    })
    it('bottoms out at 1 when every value is smaller', () => {
        expect(chartMax([{ value: 0 }, { value: 0.4 }])).toBe(1)
    })
    it('picks the largest value', () => {
        expect(chartMax([{ value: 3 }, { value: 118 }, { value: 40 }])).toBe(
            118,
        )
    })
})

describe('chartLabelPad', () => {
    it('is 0 for an empty series', () => {
        expect(chartLabelPad([])).toBe(0)
    })
    it('picks the longest label', () => {
        expect(
            chartLabelPad([
                { label: 'a' },
                { label: 'attention' },
                { label: 'bb' },
            ]),
        ).toBe(9)
    })
})

describe('chartFill', () => {
    it('fills fully when value equals max', () => {
        expect(chartFill(10, 10, 16)).toBe(16)
    })
    it('is empty at value 0', () => {
        expect(chartFill(0, 10, 16)).toBe(0)
    })
    it('scales proportionally', () => {
        expect(chartFill(5, 10, 16)).toBe(8)
    })
    it('handles a zero width', () => {
        expect(chartFill(5, 10, 0)).toBe(0)
    })
    it('rounds a mid value like the reference implementation', () => {
        expect(chartFill(118, 118, 16)).toBe(16)
        expect(chartFill(40, 118, 16)).toBe(5)
    })
    it('a non-zero value draws one bar at least — 3 against 118 is NOT zero', () => {
        // round(3 / 118 * 16) is 0: the old code drew no bar and the row read as zero
        expect(chartFill(3, 118, 16)).toBe(1)
        expect(chartFill(0.2, 1, 16)).toBe(3)
        expect(chartFill(0.01, 1, 16)).toBe(1)
    })
    it('only an actual zero (or less) draws nothing', () => {
        expect(chartFill(0, 118, 16)).toBe(0)
        expect(chartFill(-4, 118, 16)).toBe(0)
    })
    it('never exceeds the width', () => {
        expect(chartFill(200, 118, 16)).toBe(16)
    })
})

describe('chartValueWidth', () => {
    it('is 0 for an empty series', () => {
        expect(chartValueWidth([])).toBe(0)
    })
    it('is the widest printed value', () => {
        expect(chartValueWidth([{ value: 3 }, { value: 118 }, { value: 40 }])).toBe(3)
        expect(chartValueWidth([{ value: 0.5 }])).toBe(3)
    })
})

describe('fitMeterWidth', () => {
    it('fits an exact width: floor((available - extra) / ch) minus the 2 bracket glyphs', () => {
        // 176px at 8px/char = 22 cells total, minus the '[' and ']' brackets = 20
        expect(fitMeterWidth(176, 8)).toBe(20)
    })
    it('clamps a pane too narrow to the minimum rather than going negative', () => {
        // 10px at 8px/char = 1 cell, minus 2 brackets = -1 — must clamp to min, not return -1
        expect(fitMeterWidth(10, 8)).toBe(6)
    })
    it('clamps a pane far too wide to the maximum', () => {
        expect(fitMeterWidth(2000, 5)).toBe(30)
    })
    it('returns min on a zero chPx instead of dividing by zero', () => {
        expect(fitMeterWidth(200, 0)).toBe(6)
    })
    it('returns min on a NaN chPx instead of propagating NaN', () => {
        expect(fitMeterWidth(200, NaN)).toBe(6)
    })
    it('returns min on a negative chPx', () => {
        expect(fitMeterWidth(200, -5)).toBe(6)
    })
    it('returns min on a negative available width, never a negative repeat count', () => {
        expect(fitMeterWidth(-50, 8)).toBe(6)
    })
    it('subtracts extraPx before dividing, for content sharing the same line', () => {
        expect(fitMeterWidth(200, 8, { extraPx: 40 })).toBe(18)
    })
    it('honors a custom max', () => {
        expect(fitMeterWidth(2000, 5, { max: 12 })).toBe(12)
    })
    it('honors a custom min', () => {
        expect(fitMeterWidth(10, 8, { min: 4 })).toBe(4)
    })
})
