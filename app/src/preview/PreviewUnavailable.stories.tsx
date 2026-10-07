// app/src/preview/PreviewUnavailable.stories.tsx
// Visual + behavioural spec for <PreviewUnavailable> — the centred "can't show this here" block the
// preview falls back to for a binary format with no preview and for an image that failed to load.
// The "open in default app" action renders only in the desktop app, so a browser story proves the
// copy and the ABSENCE of the action.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import PreviewUnavailable from './PreviewUnavailable'

const meta = {
    title: 'Preview/PreviewUnavailable',
    component: PreviewUnavailable,
    parameters: { layout: 'fullscreen' },
    decorators: [
        Story => (
            <div style={{ display: 'flex', width: '560px', height: '280px' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof PreviewUnavailable>

export default meta
type Story = StoryObj<typeof meta>

/** A binary format the preview cannot render. */
export const Binary: Story = {
    args: {
        title: 'Preview not available',
        what: "This .PSD file can't be previewed here.",
        verb: 'view or edit it',
        onOpenExternal: () => {},
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Preview not available')).toBeInTheDocument()
        await expect(
            canvas.getByText(/This \.PSD file can't be previewed here\. Open it externally to view or edit it\./),
        ).toBeInTheDocument()
        // Not the desktop app: nothing to open it with, so no action.
        await expect(canvas.queryByText('open in default app')).toBeNull()
    },
}

/** An image whose bytes could not be decoded. */
export const ImageFailed: Story = {
    args: {
        title: "Couldn't load image",
        what: '"broken.png" could not be displayed.',
        verb: 'view it',
        onOpenExternal: () => {},
    },
}
