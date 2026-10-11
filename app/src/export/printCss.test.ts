// app/src/export/printCss.test.ts
import { test, expect, describe } from 'bun:test'
import { Window } from 'happy-dom'
import {
    injectHead,
    WEBKIT_PRINT_HEAD,
    PDF_BODY_OVERRIDE,
    PRINT_READY_TITLE,
    keepHeadingsWithNext,
    trimTrailingMargin,
} from './printCss'

describe('injectHead', () => {
    test('inserts before the first </head> (case-insensitive)', () => {
        const html = '<html><head><title>x</title></HEAD><body></body></html>'
        const out = injectHead(html, '<meta name="x">')
        expect(out).toBe(
            '<html><head><title>x</title><meta name="x"></HEAD><body></body></html>',
        )
    })

    test('prepends when there is no </head>', () => {
        const html = '<body>no head here</body>'
        const out = injectHead(html, '<meta name="x">')
        expect(out).toBe('<meta name="x"><body>no head here</body>')
    })

    test('only the FIRST occurrence is used', () => {
        const html = '<head></head><head></head>'
        const out = injectHead(html, 'X')
        expect(out).toBe('<head>X</head><head></head>')
    })
})

describe('WEBKIT_PRINT_HEAD', () => {
    test('contains PDF_BODY_OVERRIDE, -webkit-print-color-adjust:exact, and PRINT_READY_TITLE', () => {
        expect(WEBKIT_PRINT_HEAD).toContain(PDF_BODY_OVERRIDE)
        expect(WEBKIT_PRINT_HEAD).toContain('-webkit-print-color-adjust:exact')
        expect(WEBKIT_PRINT_HEAD).toContain(PRINT_READY_TITLE)
        expect(WEBKIT_PRINT_HEAD).toContain('.bismuth-keep{break-inside:avoid')
        expect(WEBKIT_PRINT_HEAD).toContain('bismuth-keep')
    })

    test('runs keep-with-next and the margin trim BEFORE setting the ready title', () => {
        const titleIndex = WEBKIT_PRINT_HEAD.indexOf('document.title=')
        for (const fn of [keepHeadingsWithNext, trimTrailingMargin]) {
            const i = WEBKIT_PRINT_HEAD.indexOf(fn.toString())
            expect(i).toBeGreaterThan(-1)
            expect(i).toBeLessThan(titleIndex)
        }
    })
})

function makeDoc(body: string): Document {
    const win = new Window()
    win.document.body.innerHTML = body
    return win.document as unknown as Document
}

describe('keepHeadingsWithNext', () => {
    test('wraps the heading alone, leaving the block after it in place', () => {
        const doc = makeDoc('<h2>A</h2><ul><li>1</li><li>2</li></ul><p>x</p>')
        keepHeadingsWithNext(doc)
        const wrap = doc.body.firstElementChild!
        expect(wrap.className).toBe('bismuth-keep')
        expect(wrap.firstElementChild!.tagName).toBe('H2')
        expect(wrap.querySelector('ul')).toBeNull()
        expect(wrap.nextElementSibling!.tagName).toBe('UL')
    })

    test('consecutive headings each get their own wrap', () => {
        const doc = makeDoc('<h2>A</h2><h3>B</h3><p>x</p>')
        keepHeadingsWithNext(doc)
        const wraps = doc.body.querySelectorAll('.bismuth-keep')
        expect(wraps.length).toBe(2)
        expect(wraps[0].querySelector('h2')).not.toBeNull()
        expect(wraps[1].querySelector('h3')).not.toBeNull()
        expect(doc.body.lastElementChild!.tagName).toBe('P')
    })

    test('a trailing heading with nothing after it is left alone', () => {
        const doc = makeDoc('<p>x</p><h2>End</h2>')
        keepHeadingsWithNext(doc)
        expect(doc.body.querySelector('.bismuth-keep')).toBeNull()
    })
})

describe('trimTrailingMargin', () => {
    test('zeroes the bottom margin down the trailing element chain only', () => {
        const doc = makeDoc('<p id="a">a</p><ul id="l"><li id="i1">1</li><li id="i2">2</li></ul>')
        trimTrailingMargin(doc)
        const mb = (id: string) =>
            (doc.getElementById(id) as HTMLElement).style.marginBottom
        expect(mb('l')).toBe('0px')
        expect(mb('i2')).toBe('0px')
        expect(mb('a')).toBe('')
        expect(mb('i1')).toBe('')
    })
})

describe('PDF_BODY_OVERRIDE', () => {
    test('carries max-width:none and body>:first-child{margin-top:0 declarations', () => {
        expect(PDF_BODY_OVERRIDE).toContain('max-width:none')
        expect(PDF_BODY_OVERRIDE).toContain('body>:first-child{margin-top:0')
    })
})
