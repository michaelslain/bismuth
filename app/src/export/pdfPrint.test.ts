// app/src/export/pdfPrint.test.ts
import { test, expect, describe, mock } from 'bun:test'
import { pickPdfEngine, printPdf, makeWebkitPrinter } from './pdfPrint'
import { WEBKIT_PRINT_HEAD } from './printCss'
import type { PdfPrinters } from './pdfPrint'

describe('pickPdfEngine', () => {
    test('tauri: true -> webkit', () => {
        expect(pickPdfEngine({ tauri: true })).toBe('webkit')
    })
    test('tauri: false -> canvas', () => {
        expect(pickPdfEngine({ tauri: false })).toBe('canvas')
    })
})

function printers(over: Partial<PdfPrinters> = {}): {
    printers: PdfPrinters
    webkitCalls: number
    canvasCalls: number
} {
    let webkitCalls = 0
    let canvasCalls = 0
    const p: PdfPrinters = {
        webkit: async () => {
            webkitCalls++
            return new Uint8Array([1])
        },
        canvas: async () => {
            canvasCalls++
            return new Uint8Array([2])
        },
        ...over,
    }
    return {
        printers: p,
        get webkitCalls() {
            return webkitCalls
        },
        get canvasCalls() {
            return canvasCalls
        },
    } as any
}

describe('printPdf', () => {
    test("engine 'webkit' calls webkit(html, title) once, canvas never", async () => {
        let webkitCalls = 0
        let canvasCalls = 0
        let capturedArgs: [string, string] | null = null
        const p: PdfPrinters = {
            webkit: async (html, title) => {
                webkitCalls++
                capturedArgs = [html, title]
                return new Uint8Array([1])
            },
            canvas: async () => {
                canvasCalls++
                return new Uint8Array([2])
            },
        }
        const bytes = await printPdf('<html></html>', 'note', 'webkit', p)
        expect(webkitCalls).toBe(1)
        expect(canvasCalls).toBe(0)
        expect(capturedArgs).toEqual(['<html></html>', 'note'])
        expect(Array.from(bytes)).toEqual([1])
    })

    test("engine 'canvas' never calls webkit", async () => {
        let webkitCalls = 0
        let canvasCalls = 0
        const p: PdfPrinters = {
            webkit: async () => {
                webkitCalls++
                return new Uint8Array([1])
            },
            canvas: async () => {
                canvasCalls++
                return new Uint8Array([2])
            },
        }
        const bytes = await printPdf('<html></html>', 'note', 'canvas', p)
        expect(webkitCalls).toBe(0)
        expect(canvasCalls).toBe(1)
        expect(Array.from(bytes)).toEqual([2])
    })

    test('a webkit printer that throws Error("boom") falls back to canvas and warns with a message containing "boom"', async () => {
        let canvasCalls = 0
        const p: PdfPrinters = {
            webkit: async () => {
                throw new Error('boom')
            },
            canvas: async () => {
                canvasCalls++
                return new Uint8Array([2])
            },
        }
        let warned: string | undefined
        const bytes = await printPdf('<html></html>', 'note', 'webkit', p, msg => {
            warned = msg
        })
        expect(canvasCalls).toBe(1)
        expect(Array.from(bytes)).toEqual([2])
        expect(warned).toBeDefined()
        expect(warned!).toContain('boom')
    })

    test('a webkit printer that throws Error("unsupported") falls back to canvas without warning', async () => {
        let canvasCalls = 0
        const p: PdfPrinters = {
            webkit: async () => {
                throw new Error('unsupported')
            },
            canvas: async () => {
                canvasCalls++
                return new Uint8Array([2])
            },
        }
        let warned = false
        const bytes = await printPdf('<html></html>', 'note', 'webkit', p, () => {
            warned = true
        })
        expect(canvasCalls).toBe(1)
        expect(Array.from(bytes)).toEqual([2])
        expect(warned).toBe(false)
    })
})

describe('makeWebkitPrinter', () => {
    test('injects WEBKIT_PRINT_HEAD via injectHead before invoking print_pdf', async () => {
        let capturedCmd = ''
        let capturedArgs: Record<string, unknown> = {}
        const invoke = mock(async (cmd: string, args: Record<string, unknown>) => {
            capturedCmd = cmd
            capturedArgs = args
            return new Uint8Array([9, 9]).buffer
        })
        const printer = makeWebkitPrinter(invoke)
        const bytes = await printer('<html><head></head><body>x</body></html>', 'my-title')
        expect(capturedCmd).toBe('print_pdf')
        expect(capturedArgs.title).toBe('my-title')
        expect(capturedArgs.html as string).toContain(WEBKIT_PRINT_HEAD)
        expect((capturedArgs.html as string).indexOf(WEBKIT_PRINT_HEAD)).toBeLessThan(
            (capturedArgs.html as string).indexOf('</head>'),
        )
        expect(Array.from(bytes)).toEqual([9, 9])
    })
})
