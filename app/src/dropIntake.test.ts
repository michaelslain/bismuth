import { describe, expect, test } from 'bun:test'
import {
    bytesFromBase64,
    imageSrcFromHtml,
    nameForImageUrl,
    pasteboardFromTransfer,
    planDrop,
    type DragPasteboard,
} from './dropIntake'

function pasteboard(overrides: Partial<DragPasteboard>): DragPasteboard {
    return { files: [], images: [], urls: [], html: null, text: null, ...overrides }
}

describe('planDrop priority order', () => {
    test('files beat everything', () => {
        const p = pasteboard({
            files: ['/Users/me/a.png'],
            images: [{ name: 'b.png', base64: 'AAAA' }],
            urls: ['https://example.com/photo.png'],
            html: '<img src="https://example.com/embedded.png">',
            text: 'hello',
        })
        expect(planDrop(p)).toEqual([{ kind: 'paths', paths: ['/Users/me/a.png'] }])
    })

    test('images beat html/url/text', () => {
        const p = pasteboard({
            images: [{ name: 'b.png', base64: 'AAAA' }],
            urls: ['https://example.com/photo.png'],
            html: '<img src="https://example.com/embedded.png">',
            text: 'hello',
        })
        expect(planDrop(p)).toEqual([{ kind: 'bytes', name: 'b.png', base64: 'AAAA' }])
    })

    test('multiple raw images each become their own bytes action', () => {
        const p = pasteboard({
            images: [
                { name: 'a.png', base64: 'AAAA' },
                { name: 'b.jpg', base64: 'BBBB' },
            ],
        })
        expect(planDrop(p)).toEqual([
            { kind: 'bytes', name: 'a.png', base64: 'AAAA' },
            { kind: 'bytes', name: 'b.jpg', base64: 'BBBB' },
        ])
    })

    test('html <img src> beats a plain image url and a non-image link', () => {
        const p = pasteboard({
            urls: ['https://example.com/other.png', 'https://example.com/page'],
            html: '<img src="https://cdn.example.com/embedded.jpg">',
            text: 'hello',
        })
        expect(planDrop(p)).toEqual([
            { kind: 'url-image', url: 'https://cdn.example.com/embedded.jpg', name: 'embedded.jpg' },
        ])
    })

    test('an image-extension url beats a non-image link when there is no html img', () => {
        const p = pasteboard({
            urls: ['https://example.com/page', 'https://example.com/shot.png'],
            text: 'hello',
        })
        expect(planDrop(p)).toEqual([
            { kind: 'url-image', url: 'https://example.com/shot.png', name: 'shot.png' },
        ])
    })

    test('a non-image link beats plain text', () => {
        const p = pasteboard({ urls: ['https://example.com/page'], text: 'hello' })
        expect(planDrop(p)).toEqual([{ kind: 'link', url: 'https://example.com/page' }])
    })

    test('plain text is the last resort', () => {
        const p = pasteboard({ text: 'hello world' })
        expect(planDrop(p)).toEqual([{ kind: 'text', text: 'hello world' }])
    })

    test('empty pasteboard yields nothing', () => {
        expect(planDrop(pasteboard({}))).toEqual([])
        expect(planDrop(pasteboard({ text: '' }))).toEqual([])
    })
})

describe('Chrome-style drag: uri-list page url + html real img src', () => {
    test('yields url-image of the img src, not the page url', () => {
        const p = pasteboard({
            urls: ['https://en.wikipedia.org/wiki/Bismuth'],
            html: '<img alt="bismuth" src="https://upload.example.org/commons/Bismuth_crystal.jpg" width="220">',
        })
        expect(planDrop(p)).toEqual([
            {
                kind: 'url-image',
                url: 'https://upload.example.org/commons/Bismuth_crystal.jpg',
                name: 'Bismuth_crystal.jpg',
            },
        ])
    })
})

describe('data: image src becomes bytes', () => {
    test('a data:image/png;base64 html img src yields a bytes action', () => {
        const p = pasteboard({
            html: '<img src="data:image/png;base64,iVBORw0KGgo=">',
        })
        const actions = planDrop(p)
        expect(actions).toEqual([
            { kind: 'bytes', name: expect.stringMatching(/^image-\d+\.png$/), base64: 'iVBORw0KGgo=' },
        ])
    })
})

describe('imageSrcFromHtml', () => {
    test('decodes &amp; in the src attribute', () => {
        const html = '<img src="https://example.com/img?a=1&amp;b=2">'
        expect(imageSrcFromHtml(html)).toBe('https://example.com/img?a=1&b=2')
    })

    test('single-quoted src is matched too', () => {
        expect(imageSrcFromHtml("<img class='x' src='https://example.com/a.png'>")).toBe(
            'https://example.com/a.png',
        )
    })

    test('a non-http(s)/data src is rejected', () => {
        expect(imageSrcFromHtml('<img src="blob:https://example.com/xyz">')).toBeNull()
    })

    test('no <img> at all yields null', () => {
        expect(imageSrcFromHtml('<p>hello</p>')).toBeNull()
    })
})

describe('nameForImageUrl', () => {
    test('strips query/fragment and percent-decodes the last segment', () => {
        expect(nameForImageUrl('https://example.com/photos/my%20shot.png?w=800#frag')).toBe(
            'my shot.png',
        )
    })

    test('a segment with no recognised image extension gets .png appended', () => {
        expect(nameForImageUrl('https://example.com/i/abcd1234?w=800')).toBe('abcd1234.png')
    })

    test('an empty/unusable path falls back to image-<timestamp>.png', () => {
        expect(nameForImageUrl('https://example.com/')).toMatch(/^image-\d+\.png$/)
    })

    test('a data: url with no path falls back using its own mime extension', () => {
        expect(nameForImageUrl('data:image/jpeg;base64,AAAA')).toMatch(/^image-\d+\.jpg$/)
        expect(nameForImageUrl('data:image/gif;base64,AAAA')).toMatch(/^image-\d+\.gif$/)
    })
})

describe('bytesFromBase64', () => {
    test('decodes to the expected byte values', () => {
        // "AB" -> base64 "QUI="
        expect(Array.from(bytesFromBase64('QUI='))).toEqual([65, 66])
    })
})

describe('pasteboardFromTransfer', () => {
    test('reads uri-list (http(s) only), html and text; files/images always empty', () => {
        const dt = {
            getData(format: string) {
                if (format === 'text/uri-list')
                    return 'file:///Users/me/a.png\r\nhttps://example.com/page\r\n'
                if (format === 'text/html') return '<b>hi</b>'
                if (format === 'text/plain') return 'hi'
                return ''
            },
        }
        expect(pasteboardFromTransfer(dt)).toEqual({
            files: [],
            images: [],
            urls: ['https://example.com/page'],
            html: '<b>hi</b>',
            text: 'hi',
        })
    })

    test('a getData that throws for one flavour still yields the others', () => {
        const dt = {
            getData(format: string) {
                if (format === 'text/uri-list') throw new Error('not a drop')
                if (format === 'text/plain') return 'still here'
                return ''
            },
        }
        expect(pasteboardFromTransfer(dt)).toEqual({
            files: [],
            images: [],
            urls: [],
            html: null,
            text: 'still here',
        })
    })

    test('null/undefined transfer yields the empty pasteboard', () => {
        const empty = { files: [], images: [], urls: [], html: null, text: null }
        expect(pasteboardFromTransfer(null)).toEqual(empty)
        expect(pasteboardFromTransfer(undefined)).toEqual(empty)
    })
})
