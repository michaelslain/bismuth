// Visual spec for <ModelGroupHead>: the `// name` heading of a model group, with and without the
// right-aligned `free` detail.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ModelGroupHead from './ModelGroupHead'

const meta = {
    title: 'Chat/ModelGroupHead',
    component: ModelGroupHead,
    parameters: { layout: 'padded' },
    decorators: [
        Story => (
            <div style={{ width: '320px', border: '1px solid var(--rule)' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof ModelGroupHead>

export default meta
type Story = StoryObj<typeof meta>

export const Plain: Story = {
    args: { label: 'lm studio' },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('lm studio')).not.toBeNull()
        await expect(c.queryByText('free')).toBeNull()
    },
}

export const WithFree: Story = {
    args: { label: 'opencode zen', detail: 'free' },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('opencode zen')).not.toBeNull()
        await expect(c.getByText('free')).not.toBeNull()
    },
}
