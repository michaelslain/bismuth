import { describe, it, expect } from 'bun:test'
import { treePrefix } from './treePrefix'

describe('treePrefix', () => {
    it('depth 0, not last', () => {
        expect(treePrefix(0, false)).toBe('|-- ')
    })
    it('depth 0, last', () => {
        expect(treePrefix(0, true)).toBe('`-- ')
    })
    it('depth 1, not last', () => {
        expect(treePrefix(1, false)).toBe('|   |-- ')
    })
    it('depth 1, last', () => {
        expect(treePrefix(1, true)).toBe('|   `-- ')
    })
    it('depth 2, not last', () => {
        expect(treePrefix(2, false)).toBe('|   |   |-- ')
    })
    it('depth 2, last', () => {
        expect(treePrefix(2, true)).toBe('|   |   `-- ')
    })
    it('depth 3, not last', () => {
        expect(treePrefix(3, false)).toBe('|   |   |   |-- ')
    })
    it('depth 3, last', () => {
        expect(treePrefix(3, true)).toBe('|   |   |   `-- ')
    })
    it('never emits box-drawing characters', () => {
        for (let depth = 0; depth <= 3; depth++) {
            for (const last of [false, true]) {
                expect(treePrefix(depth, last)).toMatch(/^[|`\- ]+$/)
            }
        }
    })
})
