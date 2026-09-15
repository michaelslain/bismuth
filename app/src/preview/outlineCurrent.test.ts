import { describe, expect, test } from 'bun:test'
import { currentOutlinePath, outlineTitleForPage } from './outlineCurrent'
import type { OutlineNode } from './annotationTypes'

const TREE: OutlineNode[] = [
    {
        title: 'Introduction',
        page: 0,
        children: [
            { title: 'Background', page: 1, children: [] },
            {
                title: 'Method',
                page: 2,
                children: [{ title: 'Sampling', page: 3, children: [] }],
            },
        ],
    },
    { title: 'Findings', page: 5, children: [] },
    { title: 'Broken destination', page: null, children: [] },
]

describe('currentOutlinePath', () => {
    test('before the first node: no current section', () => {
        expect(currentOutlinePath(TREE, -1)).toEqual([])
    })
    test('exact match on a top-level node, before any child resolves', () => {
        expect(currentOutlinePath(TREE, 0)).toEqual([0])
    })
    test('descends into the deepest matching descendant', () => {
        expect(currentOutlinePath(TREE, 3)).toEqual([0, 1, 0])
    })
    test('between a leaf and the next sibling: stays on the last matching leaf', () => {
        expect(currentOutlinePath(TREE, 4)).toEqual([0, 1, 0])
    })
    test('advances to a later top-level node once its page is reached', () => {
        expect(currentOutlinePath(TREE, 5)).toEqual([1])
    })
    test('past the end: the last resolvable node still wins', () => {
        expect(currentOutlinePath(TREE, 99)).toEqual([1])
    })
    test('a dead node (page: null) is never a match, even past its position', () => {
        expect(currentOutlinePath(TREE, 50)).toEqual([1])
    })
    test('empty outline has no current section', () => {
        expect(currentOutlinePath([], 10)).toEqual([])
    })
})

describe('outlineTitleForPage', () => {
    test('resolves the current section title', () => {
        expect(outlineTitleForPage(TREE, 3)).toBe('Sampling')
    })
    test('null before any node resolves', () => {
        expect(outlineTitleForPage(TREE, -1)).toBeNull()
    })
    test('null for an empty outline', () => {
        expect(outlineTitleForPage([], 0)).toBeNull()
    })
})
