// Visual spec for <ChatTurnColumn> — the shared 680px centred reading column every transcript row
// composes. A minimal render proving it caps and centres a wide child.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatTurnColumn from './ChatTurnColumn'

const meta = {
    title: 'Chat/ChatTurnColumn',
    component: ChatTurnColumn,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatTurnColumn>

export default meta
type Story = StoryObj<typeof meta>

/** A wide child stays capped at 680px, centred in a wider parent. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '960px', background: 'var(--surface-1)' }}>
            <ChatTurnColumn>
                <div data-testid="column-child" style={{ height: '40px' }}>
                    column content
                </div>
            </ChatTurnColumn>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByTestId('column-child')).toBeInTheDocument()
        await expect(canvas.getByText('column content')).toBeInTheDocument()
    },
}
