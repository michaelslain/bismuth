// Visual spec for <ChatNote> — the one quiet between-turns row (system notice, per-turn error,
// the "working" line). Asserts the three share one size and none is tracked.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import Caret from '../ui/Caret'
import ChatNote from './ChatNote'

const meta = {
    title: 'Chat/ChatNote',
    component: ChatNote,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatNote>

export default meta
type Story = StoryObj<typeof meta>

/** The three rows side by side — one size, no tracking, tone is the only difference. */
export const Tones: Story = {
    render: () => (
        <div style={{ width: '520px' }}>
            <ChatNote icon="Info">Browser control enabled for this turn.</ChatNote>
            <ChatNote icon="TriangleAlert" tone="danger">
                The connection dropped; send again to retry.
            </ChatNote>
            <ChatNote>
                working
                <Caret />
            </ChatNote>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const notice = getComputedStyle(
            canvas.getByText('Browser control enabled for this turn.').parentElement!,
        )
        const error = getComputedStyle(
            canvas.getByText('The connection dropped; send again to retry.')
                .parentElement!,
        )
        const working = getComputedStyle(canvas.getByText(/working/).parentElement!)
        await expect(notice.fontSize).toBe(error.fontSize)
        await expect(notice.fontSize).toBe(working.fontSize)
        await expect(working.letterSpacing).toBe('normal')
        // The error announces itself.
        await expect(canvas.getByRole('alert')).toBeInTheDocument()
    },
}
