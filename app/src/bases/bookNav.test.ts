import { describe, expect, test } from 'bun:test'
import {
    PAGE_MIN_W,
    TEXT_PAGE_ASPECT,
    readingAspect,
    clampAspect,
    fitBook,
    readoutFor,
    folioFor,
    retargetLeaf,
    stepFromKey,
} from './bookNav'
import { spreadFor, stepSpread } from '../../../core/src/bases/bookPages'

describe('fitBook', () => {
    test('a 900x700 pane fits a spread of 3:4 pages, width binding', () => {
        const f = fitBook({ w: 900, h: 700 }, 'spread')
        expect(f.layout).toBe('spread')
        expect(f.spreadDisabled).toBe(false)
        expect(f.pageSize.w).toBeCloseTo(450, 5)
        expect(f.pageSize.h).toBeCloseTo(600, 5)
    })

    test('height binds when the pane is wide and short', () => {
        const f = fitBook({ w: 1400, h: 600 }, 'spread')
        expect(f.pageSize.h).toBeCloseTo(600, 5)
        expect(f.pageSize.w).toBeCloseTo(450, 5)
    })

    test('a pane under two pages at the minimum width falls back to single', () => {
        const f = fitBook({ w: 500, h: 700 }, 'spread')
        expect(f.layout).toBe('single')
        expect(f.spreadDisabled).toBe(true)
        expect(PAGE_MIN_W * 2).toBeGreaterThan(500)
        expect(f.pageSize.w).toBeLessThanOrEqual(500)
    })

    test('an explicit single stays single without disabling spread', () => {
        const f = fitBook({ w: 900, h: 700 }, 'single')
        expect(f.layout).toBe('single')
        expect(f.spreadDisabled).toBe(false)
    })
})

describe('retargetLeaf', () => {
    test('narrowing keeps the right page of the spread on screen', () => {
        const leaf = stepSpread(0, 10, 'spread', 1) // spread [1,2]
        const single = retargetLeaf(leaf, 10, 'spread', 'single')
        expect(spreadFor(single, 10, 'single')).toEqual({ right: 2 })
    })

    test('widening again shows the spread holding that page', () => {
        const back = retargetLeaf(2, 10, 'single', 'spread')
        expect(spreadFor(back, 10, 'spread')).toEqual({ left: 1, right: 2 })
    })

    test('an unchanged layout leaves the leaf alone', () => {
        expect(retargetLeaf(3, 10, 'spread', 'spread')).toBe(3)
    })

    test('a lone last leaf on the left survives the change', () => {
        const s = spreadFor(9, 10, 'spread')
        expect(s).toEqual({ left: 9 })
        expect(retargetLeaf(9, 10, 'spread', 'single')).toBe(9)
    })
})

describe('stepFromKey', () => {
    const bindings = { next: 'ArrowRight', prev: 'ArrowLeft' }
    // an injected matcher stands in for matchesKeybinding
    const match = (e: { key: string }, setting: string) => e.key === setting

    test('maps the next and prev bindings to +1 and -1', () => {
        expect(stepFromKey({ key: 'ArrowRight' }, bindings, match)).toBe(1)
        expect(stepFromKey({ key: 'ArrowLeft' }, bindings, match)).toBe(-1)
        expect(stepFromKey({ key: 'x' }, bindings, match)).toBeNull()
    })

    test('the step feeds stepSpread', () => {
        const dir = stepFromKey({ key: 'ArrowRight' }, bindings, match)!
        expect(stepSpread(0, 6, 'spread', dir)).toBe(1)
    })
})

describe('readoutFor', () => {
    test('the cover and single layout read page N', () => {
        expect(readoutFor({ right: 0 }, 48)).toBe('page 1 // 48')
        expect(readoutFor({ right: 4 }, 48)).toBe('page 5 // 48')
    })

    test('a two-page spread reads pages A–B with an en dash', () => {
        expect(readoutFor({ left: 1, right: 2 }, 48)).toBe('pages 2–3 // 48')
    })

    test('a lone last page on the left reads page N', () => {
        expect(readoutFor({ left: 5 }, 6)).toBe('page 6 // 6')
    })
})

describe('page aspect', () => {
    test('fitBook passes a landscape aspect through to the page box', () => {
        const f = fitBook({ w: 1200, h: 700 }, 'spread', 4 / 3)
        expect(f.pageSize.w / f.pageSize.h).toBeCloseTo(4 / 3, 5)
        expect(f.pageSize.w).toBeCloseTo(600, 5)
    })
    test('an extreme aspect is clamped to [0.5, 1.6]', () => {
        expect(clampAspect(5)).toBe(1.6)
        expect(clampAspect(0.1)).toBe(0.5)
        const f = fitBook({ w: 1200, h: 700 }, 'spread', 5)
        expect(f.pageSize.w / f.pageSize.h).toBeCloseTo(1.6, 5)
    })
    test('a missing aspect falls back to 3:4', () => {
        expect(clampAspect(NaN)).toBe(0.75)
    })
})

describe('folioFor', () => {
    test('a lone page reads `n of count`', () => {
        expect(folioFor({ right: 0 }, 31)).toBe('1 of 31')
        expect(folioFor({ left: 29 }, 30)).toBe('30 of 30')
    })
    test('a two-page spread reads its range', () => {
        expect(folioFor({ left: 15, right: 16 }, 31)).toBe('16–17 of 31')
    })
})

describe('readingAspect', () => {
    test('portrait scans keep their own shape; wide photos and slivers get a reading page', () => {
        expect(readingAspect(0.77)).toBe(0.77)
        expect(readingAspect(1.6)).toBe(TEXT_PAGE_ASPECT)
        expect(readingAspect(0.5)).toBe(TEXT_PAGE_ASPECT)
    })
})
