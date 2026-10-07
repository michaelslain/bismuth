// Visual spec for <ChatCommandOutputFrame> — the boxed "command output" caption over a body.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatCommandOutputFrame from './ChatCommandOutputFrame'

const meta = {
    title: 'Chat/ChatCommandOutputFrame',
    component: ChatCommandOutputFrame,
} satisfies Meta<typeof ChatCommandOutputFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
    render: () => (
        <ChatCommandOutputFrame>
            <div style={{ padding: 'var(--sp-5)' }}>Context usage: 12% of 200k</div>
        </ChatCommandOutputFrame>
    ),
    play: async ({ canvasElement }) => {
        // A lowercase caption (ui/SectionLabel) — never an uppercase tracked head.
        const caption = within(canvasElement).getByText(/command output/)
        await expect(getComputedStyle(caption).textTransform).toBe('none')
        await expect(getComputedStyle(caption).letterSpacing).toBe('normal')
    },
}
