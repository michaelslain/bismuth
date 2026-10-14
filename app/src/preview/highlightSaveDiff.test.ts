import { describe, expect, test } from 'bun:test'
import {
    applyEditsToPages,
    diffHighlights,
    isEmptyEdits,
    sameHighlight,
} from './highlightSaveDiff'
import type { Highlight } from '../../../core/src/drawing/model'

const hl = (id: string, x = 10, c = 'hl'): Highlight => ({
    id,
    c,
    rects: [{ x, y: 20, w: 100, h: 12 }],
})

describe('diffHighlights', () => {
    test('no change is empty edits', () => {
        const set = [[hl('a'), hl('b', 50)], [hl('c')]]
        const edits = diffHighlights(set, set.map(p => p.slice()))
        expect(isEmptyEdits(edits)).toBe(true)
    })

    test('a new highlight is an add on its page', () => {
        const edits = diffHighlights([[hl('a')], []], [[hl('a')], [hl('n')]])
        expect(edits.remove).toEqual([])
        expect(edits.add).toEqual([{ page: 1, highlight: hl('n') }])
    })

    test('a missing highlight is a remove by id', () => {
        const edits = diffHighlights([[hl('a'), hl('b', 50)]], [[hl('b', 50)]])
        expect(edits.add).toEqual([])
        expect(edits.remove).toEqual([{ page: 0, id: 'a' }])
    })

    test('a kept id with new rects is a remove plus an add', () => {
        const edits = diffHighlights([[hl('a', 10)]], [[hl('a', 40)]])
        expect(edits.remove).toEqual([{ page: 0, id: 'a' }])
        expect(edits.add).toEqual([{ page: 0, highlight: hl('a', 40) }])
    })

    test('a kept id with a new colour is a remove plus an add', () => {
        const edits = diffHighlights([[hl('a')]], [[hl('a', 10, '#00ff00')]])
        expect(edits.remove).toEqual([{ page: 0, id: 'a' }])
        expect(edits.add).toHaveLength(1)
    })

    test('hl and the colour it resolves to are the same colour', () => {
        expect(sameHighlight(hl('a', 10, 'hl'), hl('a', 10, '#FFE14D'))).toBe(true)
        expect(sameHighlight(hl('a', 10, 'hl'), hl('a', 10, '#00ff00'))).toBe(false)
    })

    test('rects equal within float noise are unchanged', () => {
        const a = hl('a')
        const b: Highlight = {
            ...a,
            rects: [{ x: 10.004, y: 19.996, w: 100.003, h: 12 }],
        }
        expect(isEmptyEdits(diffHighlights([[a]], [[b]]))).toBe(true)
    })

    test('pages past the shorter set count as empty', () => {
        const edits = diffHighlights([], [[], [hl('z')]])
        expect(edits.add).toEqual([{ page: 1, highlight: hl('z') }])
        const back = diffHighlights([[], [hl('z')]], [])
        expect(back.remove).toEqual([{ page: 1, id: 'z' }])
    })
})

describe('applyEditsToPages', () => {
    test('removes by id and appends adds without duplicating', () => {
        const pages = [[hl('a'), hl('b', 50)]]
        const out = applyEditsToPages(pages, {
            remove: [{ page: 0, id: 'a' }],
            add: [
                { page: 0, highlight: hl('b', 50) },
                { page: 1, highlight: hl('n') },
            ],
        })
        expect(out.map(p => p.map(h => h.id))).toEqual([['b'], ['n']])
        expect(pages[0]).toHaveLength(2)
    })
})
