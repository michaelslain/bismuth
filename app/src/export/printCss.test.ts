// app/src/export/printCss.test.ts
import { test, expect, describe } from 'bun:test'
import {
    injectHead,
    WEBKIT_PRINT_HEAD,
    PDF_BODY_OVERRIDE,
    PRINT_READY_TITLE,
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
    })
})

describe('PDF_BODY_OVERRIDE', () => {
    test('carries max-width:none and body>:first-child{margin-top:0 declarations', () => {
        expect(PDF_BODY_OVERRIDE).toContain('max-width:none')
        expect(PDF_BODY_OVERRIDE).toContain('body>:first-child{margin-top:0')
    })
})
