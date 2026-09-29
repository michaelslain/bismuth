import { describe, expect, test } from 'bun:test'
import type { Row } from '../../../core/src/bases/types'
import {
    asNumber,
    bareName,
    capitalize,
    findColumn,
    isPagesColumn,
    isRatingColumn,
    isStatusColumn,
    isTagColumn,
    isTaskRow,
} from './columnKinds'

const row = (note: Record<string, unknown>): Row =>
    ({ file: { name: 'x', path: 'x.md' }, note }) as unknown as Row

describe('columnKinds', () => {
    test('capitalize upper-cases the first letter only', () => {
        expect(capitalize('table')).toBe('Table')
        expect(capitalize('')).toBe('')
    })

    test('bareName drops the namespace and lowercases', () => {
        expect(bareName('note.Status')).toBe('status')
        expect(bareName('file.name')).toBe('name')
        expect(bareName('Rating')).toBe('rating')
    })

    test('isStatusColumn', () => {
        expect(isStatusColumn('status')).toBe(true)
        expect(isStatusColumn('note.Status')).toBe(true)
        expect(isStatusColumn('state')).toBe(false)
    })

    test('isTagColumn', () => {
        expect(isTagColumn('tags')).toBe(true)
        expect(isTagColumn('file.tags')).toBe(true)
        expect(isTagColumn('tag')).toBe(true)
        expect(isTagColumn('label')).toBe(false)
    })

    test('isRatingColumn', () => {
        for (const id of ['rating', 'note.stars', 'score'])
            expect(isRatingColumn(id)).toBe(true)
        expect(isRatingColumn('rank')).toBe(false)
    })

    test('isPagesColumn', () => {
        for (const id of ['pages', 'note.pageCount', 'page_count'])
            expect(isPagesColumn(id)).toBe(true)
        expect(isPagesColumn('page')).toBe(false)
    })

    test('findColumn returns the first match or undefined', () => {
        expect(findColumn(['a', 'status', 'b'], isStatusColumn)).toBe('status')
        expect(findColumn(['a', 'b'], isStatusColumn)).toBeUndefined()
    })

    test('asNumber accepts finite numbers and numeric strings only', () => {
        expect(asNumber(4)).toBe(4)
        expect(asNumber('4.5')).toBe(4.5)
        expect(asNumber(' ')).toBeUndefined()
        expect(asNumber('x')).toBeUndefined()
        expect(asNumber(NaN)).toBeUndefined()
        expect(asNumber(null)).toBeUndefined()
    })

    test('isTaskRow: tasks mode is a declaration, normal mode sniffs the shape', () => {
        expect(isTaskRow(row({}), 'tasks')).toBe(true)
        expect(isTaskRow(row({}))).toBe(false)
        expect(isTaskRow(row({ line: 3, status: ' ', raw: '- [ ] a' }))).toBe(
            true,
        )
        expect(isTaskRow(row({ line: 3, status: ' ' }))).toBe(false)
    })
})
