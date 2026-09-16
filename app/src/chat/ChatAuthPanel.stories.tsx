// Visual spec for <ChatAuthPanel> — the opencode auth popover body.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatAuthPanel from './ChatAuthPanel'

const meta = {
    title: 'Chat/ChatAuthPanel',
    component: ChatAuthPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatAuthPanel>

export default meta
type Story = StoryObj<typeof meta>

export const SignedOut: Story = {
    render: () => (
        <div style={{ height: '260px' }}>
            <div style={{ position: 'relative', top: '240px' }}>
                <ChatAuthPanel providers={[]} onClose={() => {}} />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('No providers signed in yet.')).not.toBeNull()
    },
}

export const SignedIn: Story = {
    render: () => (
        <div style={{ height: '260px' }}>
            <div style={{ position: 'relative', top: '240px' }}>
                <ChatAuthPanel
                    providers={[
                        { name: 'anthropic', kind: 'oauth' },
                        { name: 'opencode zen', kind: 'api key' },
                    ]}
                    onClose={() => {}}
                />
            </div>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('anthropic')).not.toBeNull()
        await expect(canvas.getByText('opencode zen')).not.toBeNull()
    },
}
