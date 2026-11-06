// The merge and push narrowing in scripts/treeGate.ts: which tests a merge of two passed trees
// runs, and which a push of a tree that passed the fast tier runs.
import { describe, expect, test } from 'bun:test'
import { intersectSelections, onlySlowFiles } from './treeGate'
import type { Selection } from './testGraph'

const files = (...f: string[]): Selection => ({
    all: false,
    files: f,
    reasons: [`picked ${f.join(' ')}`],
})
const all: Selection = { all: true, reason: 'scripts/ changed' }

describe('intersectSelections', () => {
    test('a merge runs only the tests both sides reach', () => {
        const sel = intersectSelections(
            files('a.test.ts', 'b.test.ts'),
            files('b.test.ts', 'c.test.ts'),
        )
        expect(sel.all).toBe(false)
        if (!sel.all) expect(sel.files).toEqual(['b.test.ts'])
    })

    test('disjoint sides run nothing beyond what both always select', () => {
        const sel = intersectSelections(files('a.test.ts'), files('c.test.ts'))
        if (!sel.all) expect(sel.files).toEqual([])
    })

    test('a side that reaches everything leaves the other side picking', () => {
        expect(intersectSelections(all, files('c.test.ts'))).toEqual(
            files('c.test.ts'),
        )
        expect(intersectSelections(files('a.test.ts'), all)).toEqual(
            files('a.test.ts'),
        )
        expect(intersectSelections(all, all)).toEqual(all)
    })
})

describe('onlySlowFiles', () => {
    const slow = ['s1.test.ts', 's2.test.ts']

    test('a push of a fast-passed tree runs only the selected slow suites', () => {
        const sel = onlySlowFiles(files('a.test.ts', 's2.test.ts'), slow)
        if (!sel.all) expect(sel.files).toEqual(['s2.test.ts'])
    })

    test('a whole-tier selection becomes every slow suite', () => {
        expect(onlySlowFiles(all, slow)).toEqual({
            all: false,
            files: slow,
            reasons: [],
        })
    })
})
