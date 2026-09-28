// Visual spec for <FlashcardsProgress> — the session-progress ASCII meter. The wrapper carries the
// numeric value for assistive tech (the glyph run is aria-hidden); each story asserts it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import FlashcardsProgress from './FlashcardsProgress'

const meta = {
    title: 'Bases/FlashcardsProgress',
    component: FlashcardsProgress,
    parameters: { layout: 'padded' },
    decorators: [
        Story => (
            <div style={{ width: '520px' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof FlashcardsProgress>

export default meta
type Story = StoryObj<typeof meta>

const value = (root: HTMLElement) =>
    root.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')

export const Empty: Story = {
    args: { percent: 0 },
    play: async ({ canvasElement }) => expect(value(canvasElement)).toBe('0'),
}

export const Half: Story = {
    args: { percent: 50 },
    play: async ({ canvasElement }) => {
        expect(value(canvasElement)).toBe('50')
        // The glyph run is decorative: hidden from assistive tech.
        await waitFor(() =>
            expect(canvasElement.querySelector('[aria-hidden="true"]')).not.toBeNull(),
        )
    },
}

export const Full: Story = {
    args: { percent: 100 },
    play: async ({ canvasElement }) => expect(value(canvasElement)).toBe('100'),
}
