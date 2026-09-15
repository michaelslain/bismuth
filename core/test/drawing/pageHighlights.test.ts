import { test, expect, describe } from 'bun:test'
import {
    addHighlight,
    highlightAt,
    mergeLineRects,
    removeHighlight,
    resolveHighlightColor,
} from '../../src/drawing/pageHighlights'
import { PDF_HIGHLIGHT_YELLOW } from '../../src/theme/tokens'
import { emptyDoc, type DrawingDoc } from '../../src/drawing/model'

describe('resolveHighlightColor', () => {
    test("'hl' resolves to the shared PDF highlight yellow", () => {
        expect(resolveHighlightColor('hl')).toBe(PDF_HIGHLIGHT_YELLOW)
    })

    test('a hex colour passes through unchanged', () => {
        expect(resolveHighlightColor('#FF00AA')).toBe('#FF00AA')
    })
})

describe('addHighlight', () => {
    test('pads pages via ensurePages up to the target page', () => {
        const doc = emptyDoc()
        const out = addHighlight(
            doc,
            2,
            [{ x: 10, y: 10, w: 50, h: 12 }],
            { id: 'h1' },
        )
        expect(out.pages.length).toBe(3)
        expect(out.pages[2]!.highlights).toEqual([
            { id: 'h1', c: 'hl', rects: [{ x: 10, y: 10, w: 50, h: 12 }] },
        ])
        // Pure: the input is untouched.
        expect(doc.pages.length).toBe(1)
    })

    test('generates a non-empty id when none is given', () => {
        const out = addHighlight(emptyDoc(), 0, [{ x: 0, y: 0, w: 10, h: 10 }])
        const h = out.pages[0]!.highlights![0]!
        expect(typeof h.id).toBe('string')
        expect(h.id.length).toBeGreaterThan(0)
    })

    test('ignores empty rects — no highlight is recorded, doc is returned unchanged', () => {
        const doc = emptyDoc()
        const out = addHighlight(doc, 0, [])
        expect(out).toBe(doc)
        expect(out.pages[0]!.highlights).toBeUndefined()
    })

    test('carries an explicit colour and text, and appends to existing highlights', () => {
        const doc = addHighlight(emptyDoc(), 0, [{ x: 0, y: 0, w: 10, h: 10 }], {
            id: 'h1',
        })
        const out = addHighlight(
            doc,
            0,
            [{ x: 20, y: 20, w: 10, h: 10 }],
            { id: 'h2', c: '#123456', text: 'selected words' },
        )
        expect(out.pages[0]!.highlights).toEqual([
            { id: 'h1', c: 'hl', rects: [{ x: 0, y: 0, w: 10, h: 10 }] },
            {
                id: 'h2',
                c: '#123456',
                rects: [{ x: 20, y: 20, w: 10, h: 10 }],
                text: 'selected words',
            },
        ])
    })
})

describe('removeHighlight', () => {
    function docWith(highlights: { id: string }[]): DrawingDoc {
        let doc = emptyDoc()
        for (const h of highlights) {
            doc = addHighlight(doc, 0, [{ x: 0, y: 0, w: 10, h: 10 }], {
                id: h.id,
            })
        }
        return doc
    }

    test('removes the matching highlight only', () => {
        const doc = docWith([{ id: 'a' }, { id: 'b' }])
        const out = removeHighlight(doc, 0, 'a')
        expect(out.pages[0]!.highlights!.map(h => h.id)).toEqual(['b'])
    })

    test('a missing id is a no-op — the same doc reference is returned', () => {
        const doc = docWith([{ id: 'a' }])
        const out = removeHighlight(doc, 0, 'nope')
        expect(out).toBe(doc)
    })

    test('a page with no highlights is a no-op', () => {
        const doc = emptyDoc()
        expect(removeHighlight(doc, 0, 'anything')).toBe(doc)
    })

    test('an out-of-range page is a no-op', () => {
        const doc = docWith([{ id: 'a' }])
        expect(removeHighlight(doc, 5, 'a')).toBe(doc)
    })
})

describe('highlightAt', () => {
    test('hits the highlight whose rect contains the point', () => {
        const doc = addHighlight(
            emptyDoc(),
            0,
            [{ x: 10, y: 10, w: 100, h: 20 }],
            { id: 'h1' },
        )
        expect(highlightAt(doc, 0, { x: 50, y: 20 })?.id).toBe('h1')
    })

    test('a point outside every rect misses', () => {
        const doc = addHighlight(
            emptyDoc(),
            0,
            [{ x: 10, y: 10, w: 100, h: 20 }],
            { id: 'h1' },
        )
        expect(highlightAt(doc, 0, { x: 500, y: 500 })).toBeNull()
    })

    test('an overlap hits the TOPMOST (last-added) highlight', () => {
        let doc = addHighlight(
            emptyDoc(),
            0,
            [{ x: 0, y: 0, w: 100, h: 100 }],
            { id: 'under' },
        )
        doc = addHighlight(doc, 0, [{ x: 20, y: 20, w: 40, h: 40 }], {
            id: 'over',
        })
        expect(highlightAt(doc, 0, { x: 30, y: 30 })?.id).toBe('over')
        // Still resolves the one underneath outside the overlap.
        expect(highlightAt(doc, 0, { x: 5, y: 5 })?.id).toBe('under')
    })

    test('a null doc or an out-of-range page misses cleanly', () => {
        expect(highlightAt(null, 0, { x: 0, y: 0 })).toBeNull()
        expect(highlightAt(emptyDoc(), 9, { x: 0, y: 0 })).toBeNull()
    })
})

describe('mergeLineRects', () => {
    test('collapses several per-span rects on the same line into one union rect', () => {
        const rects = [
            { x: 0, y: 100, w: 30, h: 14 },
            { x: 30, y: 100, w: 40, h: 14 },
            { x: 70, y: 101, w: 20, h: 13 },
        ]
        expect(mergeLineRects(rects)).toEqual([
            { x: 0, y: 100, w: 90, h: 14 },
        ])
    })

    test('keeps separate lines separate', () => {
        const rects = [
            { x: 0, y: 100, w: 30, h: 14 },
            { x: 0, y: 130, w: 30, h: 14 },
        ]
        expect(mergeLineRects(rects)).toEqual([
            { x: 0, y: 100, w: 30, h: 14 },
            { x: 0, y: 130, w: 30, h: 14 },
        ])
    })

    test('drops zero-area rects', () => {
        const rects = [
            { x: 0, y: 100, w: 0, h: 14 },
            { x: 0, y: 100, w: 30, h: 0 },
            { x: 40, y: 100, w: 30, h: 14 },
        ]
        expect(mergeLineRects(rects)).toEqual([
            { x: 40, y: 100, w: 30, h: 14 },
        ])
    })

    test('an empty input returns an empty array', () => {
        expect(mergeLineRects([])).toEqual([])
    })

    test('a tighter tolerance can split rects a looser one would merge', () => {
        const rects = [
            { x: 0, y: 100, w: 30, h: 14 },
            { x: 30, y: 103, w: 30, h: 14 },
        ]
        expect(mergeLineRects(rects, 5).length).toBe(1)
        expect(mergeLineRects(rects, 1).length).toBe(2)
    })

    test('does not mutate the input array', () => {
        const rects = [{ x: 0, y: 100, w: 30, h: 14 }]
        const copy = rects.map(r => ({ ...r }))
        mergeLineRects(rects)
        expect(rects).toEqual(copy)
    })
})
