// app/src/preview/PdfZoom.stories.tsx
// Visual spec for <PdfZoom> — the `− 100% + fit` group shared by the PDF preview bar and the
// in-note PDF embed's header.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import PdfZoom from './PdfZoom'

const meta = {
    title: 'Preview/PdfZoom',
    component: PdfZoom,
} satisfies Meta<typeof PdfZoom>

export default meta
type Story = StoryObj<typeof meta>

const Live = () => {
    const [zoom, setZoom] = createSignal(1)
    return (
        <PdfZoom
            zoom={zoom}
            onZoomBy={f => setZoom(z => z * f)}
            onFit={() => setZoom(1)}
        />
    )
}

/** Rest at fit width; + steps up by 20%, fit returns to 100%. */
export const Default: Story = {
    args: { zoom: () => 1, onZoomBy: () => {}, onFit: () => {} },
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const pct = () =>
            canvasElement.querySelector('[data-testid="pdf-zoom-steps"]')
                ?.textContent
        expect(pct()).toContain('100%')
        await userEvent.click(
            canvasElement.querySelector('[aria-label="Zoom in"]')!,
        )
        await waitFor(() => expect(pct()).toContain('120%'))
        await userEvent.click(
            canvasElement.querySelector('[aria-label="Fit width"]')!,
        )
        await waitFor(() => expect(pct()).toContain('100%'))
    },
}
