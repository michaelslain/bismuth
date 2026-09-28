import { test, expect } from 'bun:test'
import {
    seedColumnMap,
    columnVocabulary,
    columnOptions,
    defaultColumnMap,
} from './calendarColumnMap'

test('an unconfigured view seeds every conventional default', () => {
    expect(seedColumnMap(undefined)).toEqual(defaultColumnMap())
})

test('an explicit column wins, an explicit empty string unsets an optional field', () => {
    const m = seedColumnMap({ dateField: 'whenDue', endTimeField: '' })
    expect(m.dateField).toBe('whenDue')
    expect(m.endTimeField).toBe('')
    expect(m.startTimeField).toBe('startTime')
})

test('vocabulary unions row keys with the standard set, minus id', () => {
    const v = columnVocabulary([{ note: { owner: 'a', id: 1, title: 't' } }])
    expect(v).toContain('owner')
    expect(v).toContain('date')
    expect(v).not.toContain('id')
    expect(v.filter(c => c === 'title')).toHaveLength(1)
})

test('optional selects lead with not set', () => {
    expect(columnOptions(['a'], true)[0]).toEqual({ value: '', label: 'not set' })
    expect(columnOptions(['a'], false)).toEqual([{ value: 'a', label: 'a' }])
})
