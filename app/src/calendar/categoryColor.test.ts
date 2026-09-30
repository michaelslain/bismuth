import { test, expect } from 'bun:test'
import {
    resolveCategoryColor,
    eventCategoryNames,
    eventCategoryColors,
    categoryOverflow,
    categoryBands,
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

test('categoryBands: 0 colours → undefined', () => {
    expect(categoryBands([], 180)).toBeUndefined()
})

test('categoryBands: one colour is still an image (a flat two-stop gradient)', () => {
    expect(categoryBands(['var(--blue)'], 180)).toBe(
        'linear-gradient(180deg, var(--blue) 0%, var(--blue) 100%)',
    )
})

test('categoryBands: full-strength hard bands, capped at MAX_BANDS, in the given direction', () => {
    expect(categoryBands(['var(--blue)', 'var(--rose)'], 90)).toBe(
        'linear-gradient(90deg, var(--blue) 0%, var(--blue) 50%, var(--rose) 50%, var(--rose) 100%)',
    )
    const four = categoryBands(['a', 'b', 'c', 'd'], 180)!
    expect(four).not.toContain(' d ')
    expect(four).toContain('b 33.3333%, b 66.6667%')
})
