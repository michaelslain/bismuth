import { describe, expect, test } from 'bun:test'
import { columnsFor, rowLabel } from './chartColumns'
import { EMPTY_FILE, type Row } from '../../../core/src/bases/types'

describe('columnsFor', () => {
    test('floors width / cell to a column count', () => {
        expect(columnsFor(640, 8)).toBe(80)
        expect(columnsFor(645, 8)).toBe(80)
    })

    test('floors at 20 minimum', () => {
        expect(columnsFor(100, 8)).toBe(20)
        expect(columnsFor(0, 8)).toBe(20)
    })

    test('a zero or negative cell width falls back to 20 columns', () => {
        expect(columnsFor(1000, 0)).toBe(20)
        expect(columnsFor(1000, -5)).toBe(20)
    })
})

describe('rowLabel', () => {
    function noteRow(note: Record<string, unknown>, index?: number): Row {
        return {
            file: { ...EMPTY_FILE, name: 'fallback', basename: 'fallback', path: 'fallback.md' },
            note,
            formula: {},
            index,
        }
    }

    test('a note row (no index) uses file.basename', () => {
        const row = noteRow({ title: 'ignored' })
        expect(rowLabel(row)).toBe('fallback')
    })

    test('a base-table row (index defined) uses its first non-empty string note value', () => {
        const row = noteRow({ count: 3, name: '', title: 'the label', other: 'second' }, 0)
        expect(rowLabel(row)).toBe('the label')
    })

    test('a base-table row with no non-empty string note value falls back to file.basename', () => {
        const row = noteRow({ count: 3, title: '' }, 0)
        expect(rowLabel(row)).toBe('fallback')
    })
})
