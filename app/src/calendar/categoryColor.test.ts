import { test, expect } from 'bun:test'
import {
    resolveCategoryColor,
    eventCategoryNames,
    eventCategoryColors,
    categoryFill,
    eventCategoryFill,
    categoryOverflow,
} from './categoryColor'
import type { Category } from './types'

const cats: Category[] = [
    { name: 'Work', color: 'blue' },
    { name: 'Home', color: 'green' },
    { name: 'Urgent', color: '#ff0000' },
]

test('resolveCategoryColor maps theme tokens to var(--token) and passes custom through', () => {
    expect(resolveCategoryColor('blue')).toBe('var(--blue)')
    expect(resolveCategoryColor('#ff0000')).toBe('#ff0000')
    expect(resolveCategoryColor(undefined)).toBe('var(--accent)')
})

test('eventCategoryNames prefers the array, falls back to legacy single, else empty', () => {
    expect(eventCategoryNames({ category: 'Work' })).toEqual(['Work'])
    expect(eventCategoryNames({ categories: ['Work', 'Home'] })).toEqual([
        'Work',
        'Home',
    ])
    // Array wins over the mirrored legacy field
    expect(
        eventCategoryNames({ category: 'Work', categories: ['Work', 'Home'] }),
    ).toEqual(['Work', 'Home'])
    expect(eventCategoryNames({})).toEqual([])
    expect(eventCategoryNames({ categories: [] })).toEqual([])
})

test('eventCategoryColors resolves each known category and drops unknown names', () => {
    expect(
        eventCategoryColors({ categories: ['Work', 'Home', 'Urgent'] }, cats),
    ).toEqual(['var(--blue)', 'var(--green)', '#ff0000'])
    expect(eventCategoryColors({ category: 'Nope' }, cats)).toEqual([])
})

test('categoryFill: 0 colours → undefined (ghost)', () => {
    expect(categoryFill([])).toBeUndefined()
})

test('categoryFill: 1 colour → solid 85% tint, not a gradient', () => {
    const fill = categoryFill(['var(--blue)'])
    expect(fill).toBe('color-mix(in srgb, var(--blue) 85%, transparent)')
    expect(fill).not.toContain('linear-gradient')
})

test('categoryFill: 2 colours → two HARD-EDGED bands, not a blend', () => {
    const fill = categoryFill(['var(--blue)', 'var(--green)'])!
    expect(fill.startsWith('linear-gradient(90deg,')).toBe(true)
    // The signature of a hard edge is a colour appearing at TWO offsets that another colour also
    // occupies — i.e. coincident stops. A blend would give each colour exactly one offset.
    expect(fill).toContain('color-mix(in srgb, var(--blue) 85%, transparent) 0%')
    expect(fill).toContain('color-mix(in srgb, var(--blue) 85%, transparent) 50%')
    expect(fill).toContain('color-mix(in srgb, var(--green) 85%, transparent) 50%')
    expect(fill).toContain('color-mix(in srgb, var(--green) 85%, transparent) 100%')
})

test('categoryFill: 3 colours → three bands at 0/33.3/66.6/100', () => {
    const fill = categoryFill(['var(--blue)', 'var(--green)', '#ff0000'])!
    expect(fill).toContain('var(--blue) 85%, transparent) 0%')
    expect(fill).toContain('var(--green) 85%, transparent) 33.3333%')
    expect(fill).toContain('#ff0000 85%, transparent) 100%')
})

test('categoryFill: NO band interpolates into its neighbour', () => {
    // The regression this whole change exists to prevent. Every colour must occupy a closed
    // interval [a%, b%] — if any colour appears at only ONE offset, CSS interpolates from it to the
    // next and the bands turn back into the mud they replaced.
    for (const colors of [
        ['#111111', '#222222'],
        ['#111111', '#222222', '#333333'],
    ]) {
        const fill = categoryFill(colors)!
        for (const c of colors) {
            const occurrences = fill.split(c).length - 1
            expect(
                occurrences,
                `${c} appears ${occurrences}x in ${fill} — a band needs exactly 2 stops (start and end); 1 means it blends`,
            ).toBe(2)
        }
    }
})

test('categoryFill: caps at MAX_BANDS and reports the overflow', () => {
    const five = ['#1', '#2', '#3', '#4', '#5']
    const fill = categoryFill(five)!
    expect(fill).toContain('#3')
    expect(fill).not.toContain('#4') // beyond the cap — counted, not drawn
    expect(categoryOverflow(five)).toBe(2)
    expect(categoryOverflow(['#1', '#2'])).toBe(0)
})

test('eventCategoryFill: single-category event stays solid, multi-category blends', () => {
    const single = eventCategoryFill({ category: 'Work' }, cats)!
    expect(single).not.toContain('linear-gradient')
    const multi = eventCategoryFill({ categories: ['Work', 'Home'] }, cats)!
    expect(multi).toContain('linear-gradient')
})
