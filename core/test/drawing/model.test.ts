import { test, expect } from 'bun:test'
import {
    emptyDoc,
    roundDoc,
    serializeDoc,
    parseDoc,
    parseDocOrEmpty,
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

const stroke = (x: number) => ({
    t: 'pen' as const,
    c: 'fg',
    w: 4,
    pts: [x, x, 255, x + 1, x + 1, 255],
})

function bigDoc() {
    const d = emptyDoc()
    d.pages = Array.from({ length: 69 }, () => ({ strokes: [] as any[] }))
    for (const i of [3, 12, 40]) d.pages[i].strokes.push(stroke(i))
    return d
}

test('serializeDoc writes a header plus one line per inked page', () => {
    const lines = serializeDoc(bigDoc()).trimEnd().split('\n')
    expect(lines.length).toBe(4)
    const head = JSON.parse(lines[0])
    expect(head.pageCount).toBe(69)
    expect(head.kind).toBe('drawing')
    expect('pages' in head).toBe(false)
    expect(lines.slice(1).map(l => JSON.parse(l).page)).toEqual([3, 12, 40])
    expect(serializeDoc(bigDoc()).endsWith('\n')).toBe(true)
})

test('JSON Lines round-trips bookmarks, margin, highlights, images and unknown keys', () => {
    const d: any = bigDoc()
    d.bookmarks = [{ id: 'b', page: 2, label: 'x' }]
    d.margin = { right: 0.5 }
    d.mystery = { a: [1, 2] }
    d.pages[12].images = [{ src: 'data:image/png;base64,AA', x: 1, y: 2, w: 3, h: 4 }]
    d.pages[40].highlights = [
        { id: 'h', c: 'hl', rects: [{ x: 1, y: 2, w: 3, h: 4 }] },
    ]
    expect(parseDoc(serializeDoc(d))).toEqual(roundDoc(d))
})

test('a doc with no inked pages is a header-only file that round-trips', () => {
    const d = emptyDoc()
    d.pages = [{ strokes: [] }, { strokes: [] }]
    const text = serializeDoc(d)
    expect(text.trimEnd().split('\n').length).toBe(1)
    expect(parseDoc(text)).toEqual(roundDoc(d))
})

test('parseDoc still reads the single-object form', () => {
    const d = emptyDoc()
    d.pages[0].strokes.push(stroke(5))
    expect(parseDoc(JSON.stringify(d))).toEqual(d)
})

test('parseDoc throws on a bad page line, an out-of-range page and a non-drawing header', () => {
    const good = serializeDoc(bigDoc()).trimEnd().split('\n')
    expect(() => parseDoc([good[0], '{"page":3,'].join('\n'))).toThrow()
    expect(() =>
        parseDoc([good[0], '{"page":69,"strokes":[]}'].join('\n')),
    ).toThrow()
    const head = { ...JSON.parse(good[0]), kind: 'nope' }
    expect(() => parseDoc([JSON.stringify(head), good[1]].join('\n'))).toThrow()
})

test('one new stroke changes exactly one line and a page greps to one line', () => {
    const d = bigDoc()
    const before = serializeDoc(d).trimEnd().split('\n')
    d.pages[12].strokes.push(stroke(99))
    const after = serializeDoc(d).trimEnd().split('\n')
    expect(after.length).toBe(before.length)
    expect(after.filter((l, i) => l !== before[i]).length).toBe(1)
    expect(after.filter(l => l.includes('"page":40')).length).toBe(1)
})

test('parseDoc reads a pretty-printed old single-object file', () => {
    const doc = emptyDoc()
    expect(parseDoc(JSON.stringify(doc, null, 2))).toEqual(doc)
})

test('parseDocOrEmpty turns empty and whitespace into a blank doc, garbage still throws', () => {
    expect(parseDocOrEmpty('')).toEqual(emptyDoc())
    expect(parseDocOrEmpty('  \n\t')).toEqual(emptyDoc())
    expect(() => parseDocOrEmpty('garbage')).toThrow()
})
