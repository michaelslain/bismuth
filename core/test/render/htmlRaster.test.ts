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
})
