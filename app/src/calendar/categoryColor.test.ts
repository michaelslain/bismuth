import { test, expect } from 'bun:test'
import {
  resolveCategoryColor,
  eventCategoryNames,
  eventCategoryColors,
  categoryFill,
  eventCategoryFill,
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
  expect(eventCategoryNames({ categories: ['Work', 'Home'] })).toEqual(['Work', 'Home'])
  // Array wins over the mirrored legacy field
  expect(eventCategoryNames({ category: 'Work', categories: ['Work', 'Home'] })).toEqual(['Work', 'Home'])
  expect(eventCategoryNames({})).toEqual([])
  expect(eventCategoryNames({ categories: [] })).toEqual([])
})

test('eventCategoryColors resolves each known category and drops unknown names', () => {
  expect(eventCategoryColors({ categories: ['Work', 'Home', 'Urgent'] }, cats)).toEqual([
    'var(--blue)',
    'var(--green)',
    '#ff0000',
  ])
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

test('categoryFill: 2 colours → two-stop linear-gradient at 0% and 100%', () => {
  const fill = categoryFill(['var(--blue)', 'var(--green)'])!
  expect(fill.startsWith('linear-gradient(135deg,')).toBe(true)
  expect(fill).toContain('color-mix(in srgb, var(--blue) 85%, transparent) 0%')
  expect(fill).toContain('color-mix(in srgb, var(--green) 85%, transparent) 100%')
})

test('categoryFill: 3 colours → three-stop gradient at 0/50/100%', () => {
  const fill = categoryFill(['var(--blue)', 'var(--green)', '#ff0000'])!
  expect(fill).toContain('var(--blue) 85%, transparent) 0%')
  expect(fill).toContain('var(--green) 85%, transparent) 50%')
  expect(fill).toContain('#ff0000 85%, transparent) 100%')
})

test('eventCategoryFill: single-category event stays solid, multi-category blends', () => {
  const single = eventCategoryFill({ category: 'Work' }, cats)!
  expect(single).not.toContain('linear-gradient')
  const multi = eventCategoryFill({ categories: ['Work', 'Home'] }, cats)!
  expect(multi).toContain('linear-gradient')
})
