// core/src/drawing/pdfHighlightText.ts
// The text under each highlight of a PDF, read with pdf.js (legacy build, no worker, no canvas
// for rendering). Desktop and CLI only: it must never be imported by core/src/localBackend.ts or
// anything under app/, because the mobile build runs core in-process without pdf.js.
//
// A highlight is a set of logical rects (816x1056 space, page box = fitImage of the page's
// natural size at scale 1). Each pdf.js text item is cut into characters, each character's centre
// is placed in the same logical space, and a character belongs to a highlight when its centre sits
// inside one of its rects. That is the rule PDFKit uses for page.selection(for:), so a Bismuth
// highlight, a Preview highlight and `bismuth highlights` agree on the words.
/// <reference path="../pdfjs-worker.d.ts" />
import { createCanvas, DOMMatrix, Path2D } from '@napi-rs/canvas'
import type { Highlight } from './model'
import { highlightPlainText } from './pageHighlights'
import { fitImage } from './pageInk'

type TextItem = {
    str: string
    transform: number[]
    width: number
    height: number
    hasEOL?: boolean
    fontName?: string
}
type Pdf = { numPages: number; getPage(n: number): Promise<Page> }
type Page = {
    getViewport(o: { scale: number }): {
        width: number
        height: number
        transform: number[]
    }
    getTextContent(): Promise<{
        items: (TextItem | { type: string })[]
        styles: Record<string, { fontFamily?: string }>
    }>
    getOperatorList(): Promise<unknown>
    commonObjs: { get(id: string): { name?: string } | undefined }
    cleanup(): void
}

let measure: ((font: string, text: string) => number) | null | undefined
function measurer() {
    if (measure !== undefined) return measure
    try {
        const ctx = createCanvas(8, 8).getContext('2d')
        measure = (font, text) => {
            ctx.font = `100px "${font}"`
            return ctx.measureText(text).width
        }
    } catch {
        measure = null
    }
    return measure
}

/** Cumulative width fractions of `str`: out[i] = share of the item's width before char i. */
function advances(str: string, font: string | undefined): number[] {
    const chars = [...str]
    const m = font ? measurer() : null
    const total = m && font ? m(font, str) : 0
    const out: number[] = []
    let prefix = ''
    for (let i = 0; i <= chars.length; i++) {
        out.push(
            total > 0 && m && font
                ? m(font, prefix) / total
                : i / Math.max(chars.length, 1),
        )
        prefix += chars[i] ?? ''
    }
    return out
}

async function pageLines(
    page: Page,
): Promise<{ chars: Char[][]; items: TextItem[] }> {
    const vp = page.getViewport({ scale: 1 })
    const box = fitImage(vp.width, vp.height)
    const k = box.w / vp.width
    const [a, b, c, d, e, f] = vp.transform as [
        number,
        number,
        number,
        number,
        number,
        number,
    ]
    const toLogical = (ux: number, uy: number) => ({
        x: box.x + (a * ux + c * uy + e) * k,
        y: box.y + (b * ux + d * uy + f) * k,
    })
    const content = await page.getTextContent()
    // The PDF's own font name (subset tag stripped) measures far closer than the generic family.
    const names = new Map<string, string>()
    try {
        await page.getOperatorList()
        for (const it of content.items) {
            const fn = (it as TextItem).fontName
            if (!fn || names.has(fn)) continue
            const n = page.commonObjs.get(fn)?.name
            if (n) names.set(fn, n.replace(/^[A-Z]{6}\+/, ''))
        }
    } catch {
        // fonts unresolved: the generic family below still places characters
    }
    const items: TextItem[] = []
    const chars: Char[][] = []
    for (const raw of content.items) {
        if (!('str' in raw) || !raw.str) continue
        const it = raw as TextItem
        const [t0, t1, , , tx, ty] = it.transform as [
            number,
            number,
            number,
            number,
            number,
            number,
        ]
        const len = Math.hypot(t0, t1) || 1
        const ux = t0 / len
        const uy = t1 / len
        const h = it.height || len
        const font =
            (it.fontName && names.get(it.fontName)) ||
            content.styles[it.fontName ?? '']?.fontFamily
        const adv = advances(it.str, font)
        const list: Char[] = []
        const cs = [...it.str]
        for (let i = 0; i < cs.length; i++) {
            const mid = ((adv[i]! + adv[i + 1]!) / 2) * it.width
            const p = toLogical(
                tx + ux * mid - uy * h * 0.3,
                ty + uy * mid + ux * h * 0.3,
            )
            list.push({ ch: cs[i]!, x: p.x, y: p.y })
        }
        items.push(it)
        chars.push(list)
    }
    return { chars, items }
}

type Char = { ch: string; x: number; y: number }

/** pdf.js under Node reaches two modules by paths a `bun build --compile` binary cannot resolve:
 *  `@napi-rs/canvas` through a runtime `createRequire` (for `DOMMatrix`/`Path2D`) and its fake
 *  worker through a computed `./pdf.worker.mjs` import. The installed CLI then fails to open every
 *  PDF. Both are reached here by literal specifiers the bundler embeds, and handed to pdf.js
 *  through the globals it checks first. */
async function preparePdfjsGlobals(): Promise<void> {
    const g = globalThis as Record<string, unknown>
    g.DOMMatrix ??= DOMMatrix
    g.Path2D ??= Path2D
    g.pdfjsWorker ??= await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
}

/** pdf.js, loaded with its one load-time warning muted: the failed `@napi-rs/canvas` require that
 *  `preparePdfjsGlobals` has already made harmless. */
async function loadPdfjs() {
    await preparePdfjsGlobals()
    const warn = console.warn
    console.warn = (...args: unknown[]) => {
        if (!String(args[0]).includes('Cannot load "@napi-rs/canvas"'))
            warn(...args)
    }
    try {
        return await import('pdfjs-dist/legacy/build/pdf.mjs')
    } finally {
        console.warn = warn
    }
}

function textUnder(
    h: Highlight,
    { chars, items }: { chars: Char[][]; items: TextItem[] },
): string | null {
    let out = ''
    let pending = ''
    let lastBase: number | null = null
    chars.forEach((list, i) => {
        const hit = list.filter(c =>
            h.rects.some(
                r =>
                    c.x >= r.x &&
                    c.x <= r.x + r.w &&
                    c.y >= r.y &&
                    c.y <= r.y + r.h,
            ),
        )
        if (hit.length === 0) {
            // Only a break between two matched pieces matters: remember it for the next hit.
            if (out && items[i]!.hasEOL) pending = '\n'
            return
        }
        const base = hit[0]!.y
        const size = items[i]!.height || 1
        const newLine =
            lastBase !== null && Math.abs(base - lastBase) > size * 0.5
        if (out) out += newLine || pending ? '\n' : ''
        pending = ''
        out += hit.map(c => c.ch).join('')
        lastBase = base
        if (items[i]!.hasEOL) pending = '\n'
    })
    const text = highlightPlainText(out)
    return text ? text : null
}

/** The text under every highlight of `pages` (`pages[i]` = page i's highlights, 0-based), in the
 *  same shape: `null` for a highlight over no text, or for everything when pdf.js cannot load
 *  `bytes`. Never throws. */
export async function pdfHighlightTexts(
    bytes: Uint8Array,
    pages: Highlight[][],
): Promise<(string | null)[][]> {
    const empty = () => pages.map(hs => hs.map(() => null))
    let task: { destroy(): Promise<void> } | null = null
    try {
        const pdfjs = await loadPdfjs()
        const loading = pdfjs.getDocument({
            data: new Uint8Array(bytes),
            useWorkerFetch: false,
            disableFontFace: true,
            verbosity: 0,
        })
        task = loading
        const doc = (await loading.promise) as unknown as Pdf
        const result: (string | null)[][] = []
        for (let i = 0; i < pages.length; i++) {
            const hs = pages[i] ?? []
            if (hs.length === 0 || i >= doc.numPages) {
                result.push(hs.map(() => null))
                continue
            }
            const page = await doc.getPage(i + 1)
            const lines = await pageLines(page)
            result.push(hs.map(h => textUnder(h, lines)))
            page.cleanup()
        }
        return result
    } catch {
        return empty()
    } finally {
        await task?.destroy().catch(() => {})
    }
}
