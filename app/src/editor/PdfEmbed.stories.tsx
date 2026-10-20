// app/src/editor/PdfEmbed.stories.tsx
// Visual spec for <PdfEmbed> — a `![[file.pdf]]` embed's face inside a note. The PDF is built in
// the browser (ui/_pdfStoryFixtures) and handed over through the `load` seam, since the fake
// transport never serves `/asset`. The box is a fixed 520px, the widget's default embed height.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import PdfEmbed from './PdfEmbed'
import { buildLetterPdf, inkedPct } from '../ui/_pdfStoryFixtures'
import { applyPdfHighlightEdits } from '../../../core/src/drawing/pdfHighlights'
import { PDF_HIGHLIGHT_YELLOW } from '../../../core/src/theme/tokens'

const meta = {
    title: 'Editor/PdfEmbed',
    component: PdfEmbed,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PdfEmbed>

export default meta
type Story = StoryObj<typeof meta>

// Built once per file load; `getDocument()` detaches the buffer it is handed, so each load
// returns a fresh copy.
let bytes: ArrayBuffer | undefined
const load = async (): Promise<ArrayBuffer> => {
    bytes ??= buildLetterPdf([
        { label: 'Page one', color: [200, 60, 60] },
        { label: 'Page two', color: [60, 140, 60] },
        { label: 'Page three', color: [60, 60, 200] },
    ])
    return bytes.slice(0)
}

const Box = (props: { children: any }) => (
    <div style={{ width: '680px', height: '520px' }}>{props.children}</div>
)

/** Rest state: the header names the file and reads `p. 1 / 3`; real pages are painted. */
export const Default: Story = {
    args: { load, name: 'papers/handbook.pdf' },
    render: args => (
        <Box>
            <PdfEmbed {...args} />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                const canvases = Array.from(
                    canvasElement.querySelectorAll('canvas'),
                ) as HTMLCanvasElement[]
                expect(canvases.some(c => inkedPct(c) > 0)).toBe(true)
            },
            { timeout: 5000 },
        )
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="page-readout"]')
                    ?.textContent,
            ).toContain('1 / 3'),
        )
        // The page stack owns its clicks, so a text selection never reveals the embed's source.
        expect(
            canvasElement.querySelector('canvas')?.closest('[data-embed-own-click]'),
        ).not.toBeNull()
    },
}

/** The header's + zooms the pages past fit width; fit brings them back. */
export const Zoomed: Story = {
    args: { load, name: 'papers/handbook.pdf' },
    render: args => (
        <Box>
            <PdfEmbed {...args} />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const page = () =>
            canvasElement.querySelector('[data-pdf-page="0"]') as HTMLElement | null
        await waitFor(() => expect(page()).not.toBeNull(), { timeout: 5000 })
        const fitWidth = page()!.getBoundingClientRect().width
        const zoomIn = canvasElement.querySelector('[aria-label="Zoom in"]')!
        await userEvent.click(zoomIn)
        await userEvent.click(zoomIn)
        await waitFor(() =>
            expect(page()!.getBoundingClientRect().width).toBeGreaterThan(
                fitWidth * 1.3,
            ),
        )
        // The steps glide (preview/createPreviewZoom), so the label lands on 144% at the end of it.
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="pdf-zoom-steps"]')
                    ?.textContent,
            ).toContain('144%'),
        )
    },
}

/** A pinch (ctrl+wheel, as Chrome reports a trackpad pinch) zooms in proportion to the fingers and
 *  keeps the spot under the pointer under the pointer. */
export const PinchZoom: Story = {
    args: { load, name: 'papers/handbook.pdf' },
    render: args => (
        <Box>
            <PdfEmbed {...args} />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        const page = () =>
            canvasElement.querySelector('[data-pdf-page="0"]') as HTMLElement | null
        await waitFor(
            () => expect(page()?.getBoundingClientRect().width).toBeGreaterThan(0),
            { timeout: 5000 },
        )
        const r0 = page()!.getBoundingClientRect()
        const x = r0.left + r0.width * 0.3
        const y = r0.top + 60
        const fx0 = (x - r0.left) / r0.width
        const fy0 = (y - r0.top) / r0.height
        const body = page()!.closest('[data-embed-own-click]') as HTMLElement
        // 20 small pinch deltas → exp(0.03 * 20) ≈ 1.82×, applied on the next frame.
        for (let i = 0; i < 20; i++) {
            body.dispatchEvent(
                new WheelEvent('wheel', {
                    deltaY: -3,
                    ctrlKey: true,
                    clientX: x,
                    clientY: y,
                    bubbles: true,
                    cancelable: true,
                }),
            )
        }
        await waitFor(() =>
            expect(
                canvasElement.querySelector('[data-testid="pdf-zoom-steps"]')
                    ?.textContent,
            ).toContain('182%'),
        )
        const r1 = page()!.getBoundingClientRect()
        expect(r1.width / r0.width).toBeCloseTo(1.82, 1)
        // The page point that was under the pointer still is (within a pixel or two).
        expect(Math.abs(r1.left + fx0 * r1.width - x)).toBeLessThan(2)
        expect(Math.abs(r1.top + fy0 * r1.height - y)).toBeLessThan(2)
    },
}

/** `![[handbook.pdf#page=2]]` opens on page two. */
export const StartsOnPage: Story = {
    args: { load, name: 'handbook.pdf', page: 'page=2' },
    render: args => (
        <Box>
            <PdfEmbed {...args} />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () =>
                expect(
                    canvasElement.querySelector('[data-testid="page-readout"]')
                        ?.textContent,
                ).toContain('2 / 3'),
            { timeout: 5000 },
        )
    },
}

/** A long path truncates in the header instead of pushing the readout off the card. */
export const LongName: Story = {
    args: {
        load,
        name: 'courses/math-128a/lectures/week-07/numerical-analysis-lecture-notes-runge-kutta.pdf',
    },
    render: args => (
        <div style={{ width: '360px', height: '420px' }}>
            <PdfEmbed {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const readout = await waitFor(() => {
            const el = canvasElement.querySelector(
                '[data-testid="page-readout"]',
            ) as HTMLElement | null
            expect(el?.textContent).toContain('1 / 3')
            return el!
        })
        const card = readout.closest('[data-embed-own-click]')!.parentElement!
        expect(readout.getBoundingClientRect().right).toBeLessThanOrEqual(
            card.getBoundingClientRect().right,
        )
    },
}

// The same document with one standard `/Highlight` annotation written into page one by the
// core writer (the bytes a highlight made in the PDF tab saves), over the label and the blank
// paper to its right.
let highlighted: Uint8Array | undefined
const loadHighlighted = async (): Promise<ArrayBuffer> => {
    highlighted ??= await applyPdfHighlightEdits(new Uint8Array(await load()), {
        add: [
            {
                page: 0,
                highlight: {
                    id: 'embed-hl',
                    c: PDF_HIGHLIGHT_YELLOW.toLowerCase(),
                    rects: [{ x: 90, y: 100, w: 330, h: 44 }],
                },
            },
        ],
        remove: [],
    })
    return highlighted.slice().buffer as ArrayBuffer
}

/** A canvas pixel at a fraction of the page, as [r, g, b]. */
function pixelAt(c: HTMLCanvasElement, fx: number, fy: number): number[] {
    const d = c
        .getContext('2d')!
        .getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data
    return [d[0], d[1], d[2]]
}

/** A PDF's own highlights show in the embed: the paper under the mark reads yellow, the paper
 *  above it stays white. */
export const WithHighlight: Story = {
    args: { load: loadHighlighted, name: 'papers/highlighted.pdf' },
    render: args => (
        <Box>
            <PdfEmbed {...args} />
        </Box>
    ),
    play: async ({ canvasElement }) => {
        await waitFor(
            () => {
                const c = canvasElement.querySelector('canvas') as HTMLCanvasElement
                expect(inkedPct(c)).toBeGreaterThan(0)
                // Page point (280pt, 92pt): blank paper inside the highlight.
                const [r, g, b] = pixelAt(c, 280 / 612, 92 / 792)
                expect(r).toBeGreaterThan(230)
                expect(g).toBeGreaterThan(190)
                expect(b).toBeLessThan(140)
            },
            { timeout: 5000 },
        )
        const c = canvasElement.querySelector('canvas') as HTMLCanvasElement
        // Page point (280pt, 50pt): paper above the highlight.
        expect(pixelAt(c, 280 / 612, 50 / 792)).toEqual([255, 255, 255])
    },
}
