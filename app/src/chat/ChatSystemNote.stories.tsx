// Visual spec for <ChatSystemNote> — a quiet, non-error system notice (BUG #87): confirms a
// client-side slash command like `/chrome` actually did something, without pretending to be part
// of the conversation (no speaker label, unlike ChatUserTurn/ChatAssistantTurn).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatSystemNote from './ChatSystemNote'

const meta = {
    title: 'Chat/ChatSystemNote',
    component: ChatSystemNote,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatSystemNote>

export default meta
type Story = StoryObj<typeof meta>

/** A single-line notice — the Info glyph + faint text, no "you"/persona label beside it. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '600px' }}>
            <ChatSystemNote text="Browser control enabled for this turn." />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Browser control enabled for this turn.'),
        ).toBeInTheDocument()
        // No speaker label — the whole point of this row vs. a ChatAssistantTurn/ChatUserTurn one.
        await expect(canvas.queryByText('you')).not.toBeInTheDocument()
        await expect(canvas.queryByText('bismuth')).not.toBeInTheDocument()
    },
}

/** A multi-line notice stays `white-space: pre-wrap` — a second line is preserved, not collapsed
 *  into one run. */
export const Multiline: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <ChatSystemNote
                text={
                    'Browser control enabled for this turn.\nA second line stays visible.'
                }
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const line = canvas.getByText(/A second line stays visible/)
        await expect(getComputedStyle(line).whiteSpace).toBe('pre-wrap')
    },
}
