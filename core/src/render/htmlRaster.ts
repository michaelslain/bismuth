// core/src/render/htmlRaster.ts — headless HTML -> PDF/PNG over CDP.
//
// The exporter (app/src/export/exporters.ts) already produces a complete, self-contained HTML
// document for a note (tables, KaTeX math, the app's own theme, all inlined) — the browser-only
// gap was never rendering fidelity, it was that the CLI had no browser to drive. This module
// drives one: launch headless Chrome (chromeSession.ts), set the document content directly (so
// nothing touches the filesystem, and no data-URL length limit applies), wait for the load event,
// and capture either a PDF (Page.printToPDF) or a PNG (Page.captureScreenshot).
//
// Geometry matches the browser exporter's own PDF path (app/src/export/pageGeometry.ts): US
// Letter portrait, 1in margins. That module also lives in a `@page { size: 8.5in 11in; margin:
// 1in; }` rule baked into every export document (htmlTemplate.ts), so Chrome's native print
// pipeline and the browser's manual html2canvas slicer agree on the same page box even though
// the two rasterizers work completely differently under the hood.
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

/** Put `html` into the page and wait for it to finish loading. Shared setup for the pdf/png/pages
 *  entry points below.
 *
 *  SETS THE DOCUMENT DIRECTLY RATHER THAN NAVIGATING TO A data: URL. The data-URL form worked
 *  until export documents began embedding their own font faces: a note carrying the prose and
 *  mono woff2 files plus KaTeX's is ~2 MB, and base64 inflates that by a third, past the length
 *  Chrome will navigate to. The failure is silent in the worst way — no error, no navigation, and
 *  the load event simply never arrives, so every export died on the 30s timeout with
 *  "timed out waiting for Page.loadEventFired" and nothing pointing at the size.
 *
 *  Page.setDocumentContent has no such limit and still touches no filesystem, which was the
 *  point of the data URL in the first place. Relative URLs cannot resolve against `about:blank`,
 *  which costs nothing here: an export document inlines every asset it uses by construction. */
async function loadHtml(
    page: Cdp,
    ws: WebSocket,
    html: string,
): Promise<void> {
    const { frameTree } = (await page('Page.getFrameTree')) as {
        frameTree: { frame: { id: string } }
    }
    const loaded = waitForEvent(ws, 'Page.loadEventFired', 30_000)
    await page('Page.setDocumentContent', {
        frameId: frameTree.frame.id,
        html,
    })
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
        // deviceScaleFactor 2 — the repo's convention for output meant to be looked at
        // (bench/visual.ts sets it explicitly; the app's own PNG export defaults to 2). At 1x
        // this shot is visibly blurrier than the app's export of the same note, which would
        // contradict the fidelity this module exists to provide.
        await session.page('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor: 2,
            mobile: false,
        })
        const { data } = await session.page('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            // clip is in CSS px; `Emulation.setDeviceMetricsOverride`'s deviceScaleFactor above
            // is what doubles the OUTPUT resolution — clip.scale stays 1 so the two don't compound.
            clip: { x: 0, y: 0, width, height, scale: 1 },
        })
        const bytes = new Uint8Array(Buffer.from(data as string, 'base64'))
        return { bytes, dataUrl: `data:image/png;base64,${data}` }
    } finally {
        session.close()
    }
}

/** The paginated Letter pages of `html`, each as a PNG data URL — `ExportDeps.htmlToPdfPages`,
 *  used ONLY by the in-app preview iframe to show what the downloaded PDF's pages will look
 *  like. Nothing in the CLI export path calls this (`bismuth export --format pdf` goes straight
 *  through `htmlToPdfHeadless` and never previews). An earlier version of this function
 *  approximated a per-page image by slicing one full-page raster into `pageCount` even
 *  horizontal bands — which is NOT what the pages actually look like the moment a document has
 *  a `.bismuth-page-break` marker or simply doesn't split at even intervals. A function that
 *  returns plausible-looking wrong data for a feature nothing yet exercises is worse than one
 *  that refuses: it would look like it worked right up until someone wires a headless preview
 *  to it, then hand back silently incorrect page images. Refuse instead until a real per-page
 *  renderer exists. `--format pdf` itself is unaffected — it never calls this function. */
export async function htmlToPdfPagesHeadless(_html: string): Promise<string[]> {
    throw new Error(
        'headless multi-page PDF preview is not implemented — this only backs the in-app preview iframe, which the CLI never renders; `bismuth export --format pdf` does not call this and works',
    )
}
