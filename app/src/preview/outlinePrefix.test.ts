import { describe, it, expect } from 'bun:test'
import { outlinePrefix } from './outlinePrefix'

describe('outlinePrefix', () => {
    it('top level (no ancestors), not last', () => {
        expect(outlinePrefix([], false)).toBe('|-- ')
    })
    it('top level, last', () => {
        expect(outlinePrefix([], true)).toBe('`-- ')
    })
    it('depth 1, ancestor not last — pipe carries down', () => {
        expect(outlinePrefix([false], false)).toBe('|   |-- ')
    })
    it('depth 1, ancestor IS last — no pipe drawn under it', () => {
        expect(outlinePrefix([true], false)).toBe('    |-- ')
    })
    it('depth 1, ancestor last, own node also last', () => {
        expect(outlinePrefix([true], true)).toBe('    `-- ')
    })
    it('depth 2, mixed ancestors: nearer-last blanks, farther-open pipes', () => {
        expect(outlinePrefix([false, true], true)).toBe('|       `-- ')
    })
    it('depth 2, no ancestor is last: two pipes carry down', () => {
        expect(outlinePrefix([false, false], false)).toBe('|   |   |-- ')
    })
    it('every ancestor segment is exactly 4 chars, plus a 4-char own connector', () => {
        const ancestors = [true, false, true]
        expect(outlinePrefix(ancestors, false).length).toBe(
            4 * ancestors.length + 4,
        )
    })
    it('never emits box-drawing characters', () => {
        const cases: boolean[][] = [[], [true], [false], [true, false], [false, false]]
        for (const ancestors of cases) {
            for (const last of [false, true]) {
                expect(outlinePrefix(ancestors, last)).toMatch(/^[|`\- ]+$/)
            }
        }
    })
})
