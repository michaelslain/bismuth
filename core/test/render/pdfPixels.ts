// Rasterise a PDF and read pixels out of it, for tests that must judge what a reader actually sees
// rather than what the file's content stream claims. Written because a content-stream assertion
// passed while the rendered output was unchanged: a fill rectangle can be present and still be
// clipped away.
import { launchChrome } from '../../src/render/chromeSession'

/** Load `pdfPath` in Chrome's own PDF viewer and return the RGB at each [x, y]. */
export async function samplePdfPixels(
    pdfPath: string,
    points: [number, number][],
): Promise<[number, number, number][]> {
    const session = await launchChrome({
        label: 'pdf-pixels',
        width: 900,
        height: 1180,
    })
    try {
        await session.page('Page.navigate', { url: `file://${pdfPath}` })
        // The viewer is a plugin; there is no load event to converge on, so give it a beat.
        await new Promise(r => setTimeout(r, 4000))
        const { data } = await session.page('Page.captureScreenshot', {
            format: 'png',
        })
        // Decode the PNG in the page itself rather than pulling in an image library.
        const expr = `(async () => {
            const img = new Image()
            img.src = 'data:image/png;base64,${data}'
            await img.decode()
            const c = document.createElement('canvas')
            c.width = img.width; c.height = img.height
            c.getContext('2d').drawImage(img, 0, 0)
            const ctx = c.getContext('2d')
            return JSON.stringify(${JSON.stringify(points)}.map(([x, y]) => {
                const d = ctx.getImageData(x, y, 1, 1).data
                return [d[0], d[1], d[2]]
            }))
        })()`
        const r = await session.page('Runtime.evaluate', {
            expression: expr,
            returnByValue: true,
            awaitPromise: true,
        })
        return JSON.parse(String(r.result?.value))
    } finally {
        await session.close()
    }
}
