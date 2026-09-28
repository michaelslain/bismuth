import { test, expect } from 'bun:test'
import {
    dateColumnOptions,
    categoryColumnOptions,
    destinationNoteOptions,
} from './taskSettingsOptions'

test('date column leads with a not set that explains the fallback', () => {
    const o = dateColumnOptions(['due'])
    expect(o[0]).toMatchObject({ value: '', label: 'not set' })
    expect(o[0].detail).toContain('scheduled')
    expect(o[1]).toEqual({ value: 'due', label: 'due' })
})

test('category column leads with a bare not set', () => {
    expect(categoryColumnOptions(['a'])).toEqual([
        { value: '', label: 'not set' },
        { value: 'a', label: 'a' },
    ])
})

test('a unique basename stores the bare wikilink, with the folder as detail', () => {
    const o = destinationNoteOptions(['Areas/Health.md', 'Projects/Site.md'])
    expect(o[1]).toMatchObject({
        value: '[[Health]]',
        label: 'Health',
        detail: 'Areas',
    })
})

test('an ambiguous basename stores a path-qualified wikilink', () => {
    const o = destinationNoteOptions(['reading/Gamma.md', 'archive/Gamma.md'])
    expect(o[1].value).not.toBe('[[Gamma]]')
    expect(o[1].value).toContain('Gamma')
    expect(o[1].value).not.toBe(o[2].value)
})
