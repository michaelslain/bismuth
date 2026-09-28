import { describe, expect, test } from 'bun:test'
import { VIEW_TYPES } from '../../../core/src/bases/types'
import { VIEW_KIND_OPTIONS, destinationOptions, withCurrent } from './selectOptions'

const OPTS = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
]

describe('withCurrent', () => {
    test('appends a missing current', () => {
        expect(withCurrent(OPTS, 'c')).toEqual([
            ...OPTS,
            { value: 'c', label: 'c' },
        ])
    })
    test('leaves a present current untouched', () => {
        expect(withCurrent(OPTS, 'a')).toBe(OPTS)
    })
    test('ignores undefined and empty', () => {
        expect(withCurrent(OPTS, undefined)).toBe(OPTS)
        expect(withCurrent(OPTS, '')).toBe(OPTS)
    })
    test('label fn shapes the appended option', () => {
        expect(
            withCurrent(OPTS, '[[Note]]', v => v.replace(/^\[\[|\]\]$/g, '')),
        ).toEqual([...OPTS, { value: '[[Note]]', label: 'Note' }])
    })
})

describe('VIEW_KIND_OPTIONS', () => {
    test('covers every view type with lowercase labels', () => {
        expect(VIEW_KIND_OPTIONS.map(o => o.value)).toEqual(VIEW_TYPES)
        expect(VIEW_KIND_OPTIONS.every(o => o.label === o.value)).toBe(true)
    })
})

describe('destinationOptions', () => {
    test('preserves order and carries the folder as detail', () => {
        const out = destinationOptions([
            { path: 'projects/alpha/Plan.md' },
            { path: 'Inbox.md', label: 'Inbox!' },
            { path: 'areas/Health.md', color: 'red' },
        ])
        expect(out).toEqual([
            { value: 'projects/alpha/Plan.md', label: 'Plan', detail: 'projects/alpha' },
            { value: 'Inbox.md', label: 'Inbox!' },
            { value: 'areas/Health.md', label: 'Health', detail: 'areas' },
        ])
    })
})
