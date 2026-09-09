// core/src/render/htmlRaster.ts — headless HTML -> PDF/PNG over CDP.
//
// The exporter (app/src/export/exporters.ts) already produces a complete, self-contained HTML
// document for a note (tables, KaTeX math, the app's own theme, all inlined) — the browser-only
// gap was never rendering fidelity, it was that the CLI had no browser to drive. This module
// drives one: launch headless Chrome (chromeSession.ts), navigate to the HTML as a
// `data:text/html;base64,` URL (so nothing touches the filesystem), wait for the load event, and
// capture either a PDF (Page.printToPDF) or a PNG (Page.captureScreenshot).
//
// Geometry matches the browser exporter's own PDF path (app/src/export/pageGeometry.ts): US
// Letter portrait, 1in margins. That module also lives in a `@page { size: 8.5in 11in; margin:
// 1in; }` rule baked into every export document (htmlTemplate.ts), so Chrome's native print
// pipeline and the browser's manual html2canvas slicer agree on the same page box even though
// the two rasterizers work completely differently under the hood.
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { launchChrome, type Cdp } from './chromeSession'

/** Wait for one CDP event by method name on the session's shared socket. Every event (from
 *  every attached target) arrives on this one WebSocket — chromeSession.ts's own doc block
 *  explains why callers must filter rather than assume the next message is theirs. A single
 *  page per session (never `newPage()`) is the only caller shape this module needs, so a bare
 *  method-name filter is unambiguous here. */
function waitForEvent(ws: WebSocket, method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            ws.removeEventListener('message', onMessage)
            reject(new Error(`timed out waiting for ${method}`))
        }, timeoutMs)
        const onMessage = (e: MessageEvent) => {
            let m: any
            try {
                m = JSON.parse(String(e.data))
            } catch {
                return
            }
            if (m.method === method) {
                clearTimeout(timer)
                ws.removeEventListener('message', onMessage)
                resolve()
            }
        }
        ws.addEventListener('message', onMessage)
    })
}

/** Navigate the page to `html` via a base64 data URL and wait for it to finish loading. Shared
 *  setup for the pdf/png/pages entry points below. */
async function loadHtml(
    page: Cdp,
    ws: WebSocket,
    html: string,
): Promise<void> {
    const dataUrl = `data:text/html;base64,${Buffer.from(html, 'utf8').toString('base64')}`
    const loaded = waitForEvent(ws, 'Page.loadEventFired', 30_000)
    await page('Page.navigate', { url: dataUrl })
    await loaded
}

/** US Letter portrait, 1in margins, printBackground true — same page box as the browser
 *  exporter's own PDF path (app/src/export/pageGeometry.ts). Returns raw PDF bytes. */
export async function htmlToPdfHeadless(html: string): Promise<Uint8Array> {
    const session = await launchChrome({ label: 'html-raster', width: 816, height: 1056 })
    try {
        await loadHtml(session.page, session.ws, html)
        const { data } = await session.page('Page.printToPDF', {
            printBackground: true,
            paperWidth: 8.5,
            paperHeight: 11,
            marginTop: 1,
            marginBottom: 1,
            marginLeft: 1,
            marginRight: 1,
        })
        return new Uint8Array(Buffer.from(data as string, 'base64'))
    } finally {
        session.close()
    }
}

/** Full-page PNG (not clipped to the viewport) via `captureBeyondViewport`. Sizes the viewport
 *  to the document's own rendered content box first, so the shot covers the whole page
 *  regardless of its height. */
export async function htmlToPngHeadless(
    html: string,
): Promise<{ bytes: Uint8Array; dataUrl: string }> {
    const session = await launchChrome({ label: 'html-raster', width: 816, height: 1056 })
    try {
        await loadHtml(session.page, session.ws, html)
        const { contentSize } = await session.page('Page.getLayoutMetrics')
        const width = Math.max(1, Math.ceil(contentSize.width))
        const height = Math.max(1, Math.ceil(contentSize.height))
        await session.page('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 1,
            mobile: false,
        })
        const { data } = await session.page('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: 0, y: 0, width, height, scale: 1 },
        })
        const bytes = new Uint8Array(Buffer.from(data as string, 'base64'))
        return { bytes, dataUrl: `data:image/png;base64,${data}` }
    } finally {
        session.close()
    }
}

/** The paginated Letter pages of `html`, each as a PNG data URL — the PDF preview path
 *  (ExportDeps.htmlToPdfPages), used only to show the preview iframe what the downloaded PDF
 *  will look like. Counts the real pages `htmlToPdfHeadless` would print (from the PDF's own
 *  object structure — every `/Type /Page` object, not `/Pages`, the tree node), then slices
 *  ONE full-page raster of the document into that many even horizontal bands. This is an
 *  approximation of the exact Letter page boxes (it does not honor `.bismuth-page-break`
 *  markers band-for-band) — acceptable for a preview image, and it needs no PDF renderer. */
export async function htmlToPdfPagesHeadless(html: string): Promise<string[]> {
    const [{ bytes: fullPng }, pdfBytes] = await Promise.all([
        htmlToPngHeadless(html),
        htmlToPdfHeadless(html),
    ])
    const pageCount = Math.max(1, countPdfPages(pdfBytes))
    if (pageCount === 1) return [bufferToDataUrl(fullPng)]

    const img = await loadImage(Buffer.from(fullPng))
    const bandH = Math.max(1, Math.ceil(img.height / pageCount))
    const pages: string[] = []
    for (let i = 0; i < pageCount; i++) {
        const y = i * bandH
        const h = Math.min(bandH, img.height - y)
        if (h <= 0) break
        const canvas = createCanvas(img.width, h)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, -y)
        pages.push(bufferToDataUrl(canvas.toBuffer('image/png')))
    }
    return pages
}

function bufferToDataUrl(bytes: Uint8Array | Buffer): string {
    return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

/** Cheap, dependency-free page count from a PDF's own object structure: every `/Type /Page`
 *  object (not `/Pages`, the tree node) is one page. Good enough for a preview — a
 *  Chrome-printed PDF is well-formed and never needs a real parser here. */
function countPdfPages(pdf: Uint8Array): number {
    const text = Buffer.from(pdf).toString('latin1')
    const matches = text.match(/\/Type\s*\/Page[^s]/g)
    return matches ? matches.length : 1
}
