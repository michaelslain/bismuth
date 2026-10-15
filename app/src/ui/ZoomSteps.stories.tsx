// app/src/ui/ZoomSteps.stories.tsx
// Visual spec for <ZoomSteps> — the `− 100% +` run shared by the preview zoom and the drawing dock.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor } from 'storybook/test'
import ZoomSteps from './ZoomSteps'

const meta = {
    title: 'UI/ZoomSteps',
    component: ZoomSteps,
} satisfies Meta<typeof ZoomSteps>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

const Live = () => {
    const [zoom, setZoom] = createSignal(1)
    return (
        <ZoomSteps
            zoom={zoom}
            onZoomOut={() => setZoom(z => Math.round((z - 0.25) * 100) / 100)}
            onZoomIn={() => setZoom(z => Math.round((z + 0.25) * 100) / 100)}
        />
    )
}

/** Rest at 100%; + and − step the percentage. */
export const Default: Story = {
    args: { zoom: () => 1, onZoomOut: noop, onZoomIn: noop },
    render: () => <Live />,
    play: async ({ canvasElement }) => {
        const text = () => canvasElement.textContent
        expect(text()).toContain('100%')
        await userEvent.click(
            canvasElement.querySelector('[aria-label="Zoom in"]')!,
        )
        await waitFor(() => expect(text()).toContain('125%'))
        await userEvent.click(
            canvasElement.querySelector('[aria-label="Zoom out"]')!,
        )
        await waitFor(() => expect(text()).toContain('100%'))
    },
}

/** At a limit the step that cannot go further is disabled. */
export const AtLimit: Story = {
    args: {
        zoom: () => 4,
        onZoomOut: noop,
        onZoomIn: noop,
        zoomInDisabled: true,
    },
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom in"]',
            )!.disabled,
        ).toBe(true)
        expect(
            canvasElement.querySelector<HTMLButtonElement>(
                '[aria-label="Zoom out"]',
            )!.disabled,
        ).toBe(false)
    },
}

/** `size="sm"` reaches both step buttons (the drawing dock's register). */
export const Small: Story = {
    args: { zoom: () => 1, onZoomOut: noop, onZoomIn: noop, size: 'sm' },
}
