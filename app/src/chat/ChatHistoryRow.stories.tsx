// Visual spec for <ChatHistoryRow> — one past conversation, as the history panel's resume list and
// search hits both render it. Each story sits in a fixed-width column so the title ellipsis and
// the right-edge time column are visible.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatHistoryRow from './ChatHistoryRow'

const meta = {
    title: 'Chat/ChatHistoryRow',
    component: ChatHistoryRow,
    parameters: { layout: 'padded' },
    decorators: [
        Story => (
            <div style={{ width: '440px' }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof ChatHistoryRow>

export default meta
type Story = StoryObj<typeof meta>

const MIN = 60_000

export const Plain: Story = {
    args: {
        summary: 'Restyle the daemon page',
        lastModified: Date.now() - 5 * MIN,
        origin: 'user',
        onClick: () => {},
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('Restyle the daemon page'),
        ).toBeInTheDocument()
        await expect(canvas.getByText('5m ago')).toBeInTheDocument()
    },
}

export const WithSnippet: Story = {
    args: {
        summary: 'Restyle the daemon page',
        lastModified: Date.now() - 5 * MIN,
        origin: 'user',
        snippet:
            'the chat controls should be one quiet row under the composer, with the model and the permission mode as plain readouts and history and new chat as the only two commands on it, so nothing competes with the message itself',
        onClick: () => {},
    },
}

export const DaemonOrigin: Story = {
    args: {
        summary: 'dream — nightly vault review',
        lastModified: Date.now() - 3 * 60 * MIN,
        origin: 'daemon',
        onClick: () => {},
    },
}

export const LongTitle: Story = {
    args: {
        summary:
            'Work out why the calendar month grid clips its last two week rows when the pane is short and the event chips wrap',
        lastModified: Date.now() - 2 * 24 * 60 * MIN,
        origin: 'user',
        onClick: () => {},
    },
}

export const Untitled: Story = {
    args: {
        summary: '   ',
        lastModified: Date.now() - 40 * 24 * 60 * MIN,
        onClick: () => {},
    },
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('Untitled session'),
        ).toBeInTheDocument()
    },
}

/** The arrow-key cursor's paint — what the panel shows on the row Up/Down has reached. */
export const Active: Story = {
    args: {
        summary: 'Restyle the daemon page',
        lastModified: Date.now() - 5 * MIN,
        origin: 'user',
        active: true,
        onClick: () => {},
    },
}
