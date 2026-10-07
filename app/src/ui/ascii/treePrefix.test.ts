import { describe, it, expect } from 'bun:test'
import { ancestorsLastOf, treePrefix } from './treePrefix'

describe('treePrefix', () => {
    it('depth 0 needs no ancestors', () => {
        expect(treePrefix(0, false, [])).toBe('|-- ')
        expect(treePrefix(0, true, [])).toBe('`-- ')
    })
    it('a non-last ancestor keeps its `|` running down', () => {
        expect(treePrefix(1, false, [false])).toBe('|   |-- ')
        expect(treePrefix(1, true, [false])).toBe('|   `-- ')
        expect(treePrefix(3, true, [false, false, false])).toBe('|   |   |   `-- ')
    })
    it('a LAST ancestor contributes blanks, not `|` — the `|` must not run under a `-- terminator', () => {
        expect(treePrefix(1, false, [true])).toBe('    |-- ')
        expect(treePrefix(1, true, [true])).toBe('    `-- ')
        expect(treePrefix(2, true, [true, true])).toBe('        `-- ')
        expect(treePrefix(2, false, [false, true])).toBe('|       |-- ')
        expect(treePrefix(2, false, [true, false])).toBe('    |   |-- ')
    })
    it('a missing ancestor entry reads as not-last', () => {
        expect(treePrefix(2, false, [])).toBe('|   |   |-- ')
    })
    it('every prefix is the connector width: 4 columns per depth plus the 4-column connector', () => {
        for (let depth = 0; depth <= 3; depth++)
            for (const last of [false, true])
                for (const a of [false, true])
                    expect(treePrefix(depth, last, Array(depth).fill(a)).length).toBe(4 * (depth + 1))
    })
    it('never emits box-drawing characters', () => {
        for (let depth = 0; depth <= 3; depth++)
            for (const last of [false, true])
                for (const a of [false, true])
                    expect(treePrefix(depth, last, Array(depth).fill(a))).toMatch(/^[|`\- ]+$/)
    })
})

describe('ancestorsLastOf', () => {
    it('reads each ancestor level off the nearest preceding row at that depth', () => {
        const rows = [
            { depth: 0 },
            { depth: 1 },
            { depth: 1, last: true },
            { depth: 0, last: true },
            { depth: 1 },
            { depth: 2, last: true },
            { depth: 1, last: true },
        ]
        expect(ancestorsLastOf(rows)).toEqual([[], [false], [false], [], [true], [true, false], [true]])
    })
    it('a last folder with children: the children carry a blank column, not a `|`', () => {
        const rows = [{ depth: 0, last: true }, { depth: 1 }, { depth: 1, last: true }]
        const anc = ancestorsLastOf(rows)
        expect(rows.map((r, i) => treePrefix(r.depth, !!r.last, anc[i]!))).toEqual(['`-- ', '    |-- ', '    `-- '])
    })
})
