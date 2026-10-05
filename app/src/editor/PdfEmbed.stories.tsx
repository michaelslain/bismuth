// app/src/editor/PdfEmbed.stories.tsx
// Visual spec for <PdfEmbed> — a `![[file.pdf]]` embed's face inside a note. The PDF is built in
// the browser (ui/_pdfStoryFixtures) and handed over through the `load` seam, since the fake
// transport never serves `/asset`. The box is a fixed 520px, the widget's default embed height.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import PdfEmbed from './PdfEmbed'
import { buildLetterPdf, inkedPct } from '../ui/_pdfStoryFixtures'

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
        expect(
            canvasElement.querySelector('[data-testid="pdf-zoom-steps"]')
                ?.textContent,
        ).toContain('144%')
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
