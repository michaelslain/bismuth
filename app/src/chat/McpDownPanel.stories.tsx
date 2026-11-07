// Visual spec for <McpDownPanel> — the box the chat header's `N mcp servers down` warning opens.
// Shown inside its real <Popover>; ChatReadouts.stories.tsx drives it through the warning.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent } from 'storybook/test'
import McpDownPanel from './McpDownPanel'
import Popover from '../ui/Popover'

const meta = {
    title: 'Chat/McpDownPanel',
    component: McpDownPanel,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof McpDownPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Two servers down, each with the status the session reported. */
export const TwoDown: Story = {
    args: {
        servers: [
            { name: 'railway', status: 'failed' },
            { name: 'touchdesigner-mcp', status: 'needs-auth' },
        ],
        onHide: fn(),
        onMute: fn(),
    },
    render: args => (
        <Popover tone="panel">
            <McpDownPanel {...args} />
        </Popover>
    ),
    play: async ({ canvasElement, args }) => {
        expect(canvasElement.textContent).toContain('needs auth')
        const buttons = [...canvasElement.querySelectorAll('button')]
        await userEvent.click(buttons.find(b => b.textContent === 'hide')!)
        await userEvent.click(buttons.find(b => b.textContent === 'never show again')!)
        expect(args.onHide).toHaveBeenCalledOnce()
        expect(args.onMute).toHaveBeenCalledOnce()
    },
}

/** One server down. */
export const OneDown: Story = {
    args: {
        servers: [{ name: 'linear', status: 'failed' }],
        onHide: fn(),
        onMute: fn(),
    },
    render: args => (
        <Popover tone="panel">
            <McpDownPanel {...args} />
        </Popover>
    ),
}
