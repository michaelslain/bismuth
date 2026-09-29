import { test, expect } from 'bun:test'
import {
    seedColumnMap,
    columnVocabulary,
    columnOptions,
    defaultColumnMap,
    writeColumnMap,
    FIELDS,
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

test('writeColumnMap throws when the base was skipped as vanished', async () => {
    const set = async () => ({ skipped: ['cal.md'] })
    await expect(writeColumnMap(set, 'cal.md', {})).rejects.toThrow(
        /no longer exists/,
    )
})

test('writeColumnMap resolves when nothing was skipped', async () => {
    const set = async () => ({ skipped: [] })
    await expect(writeColumnMap(set, 'cal.md', {})).resolves.toBeUndefined()
})

test('writeColumnMap writes one entry per field, empty for unmapped', async () => {
    let seen: Array<{ path: string; key: string; value: unknown }> = []
    const set = async (w: typeof seen) => {
        seen = w
        return { skipped: [] }
    }
    await writeColumnMap(set, 'cal.md', { dateField: 'when' })
    expect(seen.map(w => w.key)).toEqual(FIELDS.map(f => f.key))
    expect(seen.every(w => w.path === 'cal.md')).toBe(true)
    expect(seen.find(w => w.key === 'dateField')?.value).toBe('when')
    expect(seen.find(w => w.key === 'endTimeField')?.value).toBe('')
})
