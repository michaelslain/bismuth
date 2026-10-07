import { test, expect } from 'bun:test'
import { stepOverflow, type OverflowState } from './overflowLatch'

const shown: OverflowState = { hidden: false }
const fits = { metaBottom: 40, chipHeight: 60, width: 120, height: 60 }
const spills = { metaBottom: 80, chipHeight: 60, width: 120, height: 60 }

test('a meta row that fits stays shown', () => {
    expect(stepOverflow(shown, fits)).toEqual(shown)
})

test('a meta row that spills latches hidden, remembering the chip size', () => {
    expect(stepOverflow(shown, spills)).toEqual({ hidden: true, width: 120, height: 60 })
})

test('hidden stays hidden while the chip is the same size, even if re-measured', () => {
    const latched = stepOverflow(shown, spills)
    // a hidden meta row is 0 tall, so its measured bottom says nothing
    expect(stepOverflow(latched, { ...fits, metaBottom: 0 })).toEqual(latched)
    expect(stepOverflow(latched, spills)).toEqual(latched)
})

test('hidden releases when the chip widens or grows taller', () => {
    const latched = stepOverflow(shown, spills)
    expect(stepOverflow(latched, { ...fits, width: 260 })).toEqual({ hidden: false })
    expect(stepOverflow(latched, { ...fits, height: 90 })).toEqual({ hidden: false })
})

test('after a release, a chip that still does not fit latches again at its new size', () => {
    const latched = stepOverflow(shown, spills)
    const released = stepOverflow(latched, { ...spills, width: 140 })
    expect(released).toEqual({ hidden: false })
    expect(stepOverflow(released, { ...spills, width: 140 })).toEqual({
        hidden: true,
        width: 140,
        height: 60,
    })
})
