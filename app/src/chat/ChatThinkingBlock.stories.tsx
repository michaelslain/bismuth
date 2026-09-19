// Visual spec for <ChatThinkingBlock> — a dim, collapsible one-liner for a turn's extended-
// thinking text. `Expandable`'s play() clicks the row and asserts the reasoning text appears,
// proving the collapse/expand behaviour (not just the closed-state render).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import ChatThinkingBlock from './ChatThinkingBlock'
import type { ThinkingPart } from '../chatTranscript'

const meta = {
    title: 'Chat/ChatThinkingBlock',
    component: ChatThinkingBlock,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatThinkingBlock>

export default meta
type Story = StoryObj<typeof meta>

const part: ThinkingPart = {
    kind: 'thinking',
    text: 'The build step ran the full test suite instead of the fast subset — that adds about four minutes.',
}

/** Collapsed by default — just the dim "Thinking" label, reasoning text not in the DOM at all. */
export const Collapsed: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatThinkingBlock part={part} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Thinking')).toBeInTheDocument()
        await expect(canvas.queryByText(/full test suite/)).not.toBeInTheDocument()
    },
}

/** Clicking the row expands it to the raw reasoning text. */
export const Expandable: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatThinkingBlock part={part} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText('Thinking'))
        await expect(canvas.getByText(/full test suite/)).toBeInTheDocument()
    },
}
