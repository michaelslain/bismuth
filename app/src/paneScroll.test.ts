import { test, expect } from 'bun:test'
import {
    PAGE_FRACTION,
    maxScroll,
    parseScrollOp,
    pickScroller,
    position,
    targetTop,
} from './paneScroll'

const m = { scrollTop: 100, scrollHeight: 2000, clientHeight: 500 }

test('targetTop moves by pixels, by pages and to absolute places, clamped', () => {
    expect(targetTop({ by: 300 }, m)).toBe(400)
    expect(targetTop({ by: -300 }, m)).toBe(0)
    expect(targetTop({ by: 99999 }, m)).toBe(1500)
    expect(targetTop({ pages: 1 }, m)).toBe(100 + 500 * PAGE_FRACTION)
    expect(targetTop({ pages: -1 }, m)).toBe(0)
    expect(targetTop({ to: 'top' }, m)).toBe(0)
    expect(targetTop({ to: 'bottom' }, m)).toBe(1500)
    expect(targetTop({ to: 0.5 }, m)).toBe(750)
})

test('position reports top, max, height and a fraction; nothing overflowing is fraction 0', () => {
    expect(position({ ...m, scrollTop: 750 })).toEqual({
        top: 750,
        max: 1500,
        height: 500,
        fraction: 0.5,
    })
    expect(
        maxScroll({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 }),
    ).toBe(0)
    expect(
        position({ scrollTop: 0, scrollHeight: 300, clientHeight: 500 })
            .fraction,
    ).toBe(0)
})

test('parseScrollOp accepts one of by/pages/to and names what is wrong otherwise', () => {
    expect(parseScrollOp(undefined)).toBeUndefined()
    expect(parseScrollOp({ by: -40 })).toEqual({ by: -40 })
    expect(parseScrollOp({ pages: 2 })).toEqual({ pages: 2 })
    expect(parseScrollOp({ to: 'bottom' })).toEqual({ to: 'bottom' })
    expect(parseScrollOp({ to: 0.25 })).toEqual({ to: 0.25 })
    expect(parseScrollOp({ to: 2 })).toBeTypeOf('string')
    expect(parseScrollOp({ to: 'middle' })).toBeTypeOf('string')
    expect(parseScrollOp({ by: 'far' })).toBeTypeOf('string')
    expect(parseScrollOp({ by: 1, pages: 1 })).toBeTypeOf('string')
    expect(parseScrollOp({ sideways: 1 })).toBeTypeOf('string')
    expect(parseScrollOp(5)).toBeTypeOf('string')
})

type Fake = {
    name: string
    scrollTop: number
    scrollHeight: number
    clientHeight: number
    clientWidth: number
    overflow: string
}
const el = (
    name: string,
    sh: number,
    ch: number,
    cw: number,
    overflow: string,
): Fake => ({
    name,
    scrollTop: 0,
    scrollHeight: sh,
    clientHeight: ch,
    clientWidth: cw,
    overflow,
})

test('pickScroller picks the largest element that overflows and is styled to scroll', () => {
    const pick = (els: Fake[]) =>
        pickScroller(els, e => e.overflow)?.name ?? null
    // the pane root clips (hidden), a small sidebar list scrolls, the editor body scrolls: body wins
    expect(
        pick([
            el('root', 3000, 800, 1000, 'hidden'),
            el('sidebar', 900, 300, 200, 'auto'),
            el('body', 3000, 760, 1000, 'auto'),
        ]),
    ).toBe('body')
    // styled to scroll but nothing overflows: not a candidate
    expect(pick([el('short', 400, 800, 1000, 'auto')])).toBeNull()
    // overflowing but not scrollable (visible): not a candidate
    expect(pick([el('visible', 3000, 800, 1000, 'visible')])).toBeNull()
    // equal size: document order keeps the outer one
    expect(
        pick([
            el('outer', 3000, 800, 1000, 'scroll'),
            el('inner', 2000, 800, 1000, 'auto'),
        ]),
    ).toBe('outer')
})
