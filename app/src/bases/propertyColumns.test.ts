import { describe, expect, test } from 'bun:test'
import { columnsOf } from './propertyColumns'
import type { Row } from '../../../core/src/bases/types'

const r = (name: string | undefined, note: Record<string, unknown>) =>
    ({ file: name ? { name } : {}, note }) as unknown as Row

describe('columnsOf', () => {
    test('union of note keys in first-seen order, file.name first when any row has a name', () => {
        expect(
            columnsOf([r('a', { status: 'x', due: '2026-01-01' }), r('b', { status: 'y', tags: [] })]),
        ).toEqual(['file.name', 'status', 'due', 'tags'])
    })
    test('no file names -> no file.name', () => {
        expect(columnsOf([r(undefined, { a: 1 })])).toEqual(['a'])
    })
    test('empty', () => {
        expect(columnsOf([])).toEqual([])
    })
})
