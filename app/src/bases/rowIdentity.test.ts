import { test, expect, describe } from 'bun:test'
import { rowId } from './rowIdentity'
import { syntheticBaseFile, placeholderFile } from '../../../core/src/bases/types'
import type { Row } from '../../../core/src/bases/types'

const stored = (index: number): Row => ({
    file: syntheticBaseFile('boards/b.md'),
    note: { description: `row ${index}` },
    formula: {},
    index,
})
const note = (path: string): Row => ({
    file: placeholderFile(path.split('/').pop()!, path),
    note: {},
    formula: {},
})

describe('rowId', () => {
    test('two rows stored in ONE base file get DIFFERENT keys', () => {
        expect(rowId(stored(0))).not.toBe(rowId(stored(1)))
    })

    test('a note row is keyed by its path, unchanged', () => {
        expect(rowId(note('notes/a.md'))).toBe('notes/a.md')
    })

    test('two notes never collide with a stored row of the same base', () => {
        const keys = [rowId(note('boards/b.md')), rowId(stored(0))]
        expect(new Set(keys).size).toBe(2)
    })

    test('a non-integer index is treated as no index, not as a key', () => {
        // Matches canWriteStoredRow: `typeof NaN` is 'number' and so is 2.5, and neither is
        // a write-back handle. A key minted from one would look stable and address nothing.
        expect(rowId({ ...stored(0), index: 2.5 })).toBe('boards/b.md')
        expect(rowId({ ...stored(0), index: NaN })).toBe('boards/b.md')
    })

    test('the key is stable across re-resolves of the same row', () => {
        expect(rowId(stored(3))).toBe(rowId(stored(3)))
    })
})
