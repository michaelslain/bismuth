import { test, expect } from 'bun:test'
import {
    emptyDoc,
    roundDoc,
    serializeDoc,
    parseDoc,
    PAGE_W,
    PAGE_H,
} from '../../src/drawing/model'

test('emptyDoc has one blank page and grid paper', () => {
    const d = emptyDoc()
    expect(d.v).toBe(1)
    expect(d.kind).toBe('drawing')
    expect(d.pages.length).toBe(1)
    expect(d.pages[0].strokes).toEqual([])
    expect([PAGE_W, PAGE_H]).toEqual([816, 1056])
})

test('roundDoc rounds x/y to ints and clamps pressure to 0..255', () => {
    const d = emptyDoc()
    d.pages[0].strokes.push({
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: [10.4, 20.6, 300, 11.9, 21.1, -5],
    })
    const r = roundDoc(d)
    expect(r.pages[0].strokes[0].pts).toEqual([10, 21, 255, 12, 21, 0])
})

test('serialize then parse round-trips a doc', () => {
    const d = emptyDoc()
    d.paper.bg = 'lines'
    d.pages[0].strokes.push({
        t: 'hl',
        c: '#e23b3b',
        w: 8,
        straight: true,
        pts: [0, 0, 255, 100, 50, 255],
    })
    expect(parseDoc(serializeDoc(d))).toEqual(d)
})

test('parseDoc rejects non-drawing JSON with a clear error', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow(/not a drawing/i)
})

test('roundDoc preserves page images, rounds geometry, never touches src', () => {
    const src = 'data:image/png;base64,AAAA'
    const d = emptyDoc()
    d.pages[0].images = [{ src, x: 10.4, y: 20.6, w: 100.9, h: 50.1 }]
    const r = roundDoc(d)
    expect(r.pages[0].images).toEqual([{ src, x: 10, y: 21, w: 101, h: 50 }])
    // The data URL must survive byte-for-byte (rounding it would corrupt the image).
    expect(r.pages[0].images![0].src).toBe(src)
})

test('a page with no images stays image-less after roundDoc (old files unchanged)', () => {
    const d = emptyDoc()
    const r = roundDoc(d)
    expect('images' in r.pages[0]).toBe(false)
})

test('roundDoc preserves page highlights, rounds rects, leaves id/c/text untouched', () => {
    const d = emptyDoc()
    d.pages[0].highlights = [
        {
            id: 'hl-1',
            c: 'hl',
            text: 'some selected text',
            rects: [{ x: 10.4, y: 20.6, w: 100.9, h: 12.1 }],
        },
    ]
    const r = roundDoc(d)
    expect(r.pages[0].highlights).toEqual([
        {
            id: 'hl-1',
            c: 'hl',
            text: 'some selected text',
            rects: [{ x: 10, y: 21, w: 101, h: 12 }],
        },
    ])
})

test('a page with no highlights stays highlight-less after roundDoc (old files unchanged)', () => {
    const d = emptyDoc()
    const r = roundDoc(d)
    expect('highlights' in r.pages[0]).toBe(false)
})

test('bookmarks, margin and highlights all round-trip through serializeDoc -> parseDoc', () => {
    const d = emptyDoc()
    d.pages[0].highlights = [
        {
            id: 'hl-1',
            c: '#e23b3b',
            text: 'quoted passage',
            rects: [
                { x: 12, y: 34, w: 200, h: 14 },
                { x: 12, y: 48, w: 150, h: 14 },
            ],
        },
    ]
    d.bookmarks = [{ id: 'bm-1', page: 2, label: 'Introduction' }]
    d.margin = { right: 0.6 }
    expect(parseDoc(serializeDoc(d))).toEqual(d)
})

test('serialize then parse round-trips a doc that contains an image', () => {
    const d = emptyDoc()
    d.pages[0].images = [
        { src: 'data:image/png;base64,ZZ', x: 8, y: 8, w: 800, h: 600 },
    ]
    d.pages[0].strokes.push({
        t: 'pen',
        c: 'fg',
        w: 4,
        pts: [0, 0, 255, 10, 10, 255],
    })
    expect(parseDoc(serializeDoc(d))).toEqual(d)
})
