// Visual spec for <ChatCommandOutputFrame> — the boxed "Command output" header over a body.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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
}
