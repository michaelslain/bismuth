import { describe, expect, test } from 'bun:test'
import { splitStatusPath } from './statusPath'

describe('splitStatusPath', () => {
    test('keeps the trailing slash on the folder', () => {
        expect(splitStatusPath('archive/notes/a b.md')).toEqual({
            dir: 'archive/notes/',
            name: 'a b.md',
        })
    })
    test('a bare label is all name', () => {
        expect(splitStatusPath('Some memory')).toEqual({ dir: '', name: 'Some memory' })
    })
})
