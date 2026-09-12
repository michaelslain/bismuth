import { describe, expect, test } from 'bun:test'
import { htmlToPdfHeadless, htmlToPngHeadless } from '../../src/render/htmlRaster'
import { shouldRunSlowTests } from '../slowGate'

const html = '<html><body><h1>Hello</h1><table><tr><td>a</td><td>b</td></tr></table></body></html>'

// Launches a real headless Chrome, so this is gated as a SLOW suite (see slowGate.ts): the
// pre-commit gate skips it for latency; pre-push and CI still run it in full.
const describeOrSkipSlow = shouldRunSlowTests(process.env) ? describe : describe.skip

describeOrSkipSlow('htmlRaster', () => {
    test('produces a real PDF', async () => {
        const bytes = await htmlToPdfHeadless(html)
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        expect(bytes.length).toBeGreaterThan(1000)
    }, 60_000)

    test('produces a real PNG', async () => {
        const { bytes } = await htmlToPngHeadless(html)
        expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    }, 60_000)

    // A document PAST THE data: URL LENGTH LIMIT. loadHtml used to navigate to
    // `data:text/html;base64,<the whole document>`, which worked only while export documents were
    // small. Once they began embedding their own font faces — the prose and mono woff2 files plus
    // KaTeX's, ~2 MB before base64 inflates it by a third — Chrome silently refused to navigate:
    // no error, no navigation, and the load event simply never arrived, so every export died on
    // the 30s timeout with nothing pointing at the size. The existing cases above could not catch
    // it because their document is one line long.
    test('renders a document far larger than a data: URL can carry', async () => {
        // ~3 MB of real markup, comfortably past the limit that broke the data-URL path.
        const filler = '<p>' + 'x'.repeat(120) + '</p>\n'
        const big = `<html><body><h1>Big</h1>${filler.repeat(25_000)}</body></html>`
        expect(big.length).toBeGreaterThan(3_000_000)
        const bytes = await htmlToPdfHeadless(big)
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        expect(bytes.length).toBeGreaterThan(1000)
    }, 120_000)
})
