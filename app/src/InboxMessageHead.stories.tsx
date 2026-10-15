// Visual spec for <InboxMessageHead> — the sender line on every message of an inbox page: the
// daemon in sage, you in ink, an optional `// detail`, the time at the trailing edge.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import InboxMessageHead from './InboxMessageHead'

const ago = (m: number) => new Date(Date.now() - m * 60e3).toISOString()

const meta = {
    title: 'App/InboxMessageHead',
    component: InboxMessageHead,
    parameters: { layout: 'centered' },
    render: args => (
        <div style={{ width: '760px' }}>
            <InboxMessageHead {...args} />
        </div>
    ),
} satisfies Meta<typeof InboxMessageHead>

export default meta
type Story = StoryObj<typeof meta>

/** The daemon, with the cron it came from. */
export const Daemon: Story = {
    args: { from: 'daemon', detail: 'answer-emails', at: ago(120) },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent || '').toMatch(/daemon\s*\/\/ answer-emails\s*2h ago/)
    },
}

/** You, by email. The time stays at the trailing edge. */
export const YouByEmail: Story = {
    args: { from: 'you', detail: 'by email', at: ago(3) },
    play: async ({ canvasElement }) => {
        const spans = canvasElement.querySelectorAll('span')
        const last = spans[spans.length - 1].getBoundingClientRect()
        await expect(last.right).toBeGreaterThan(canvasElement.querySelector('div')!.getBoundingClientRect().left + 700)
    },
}

/** You, in the app: no detail. */
export const You: Story = {
    args: { from: 'you', at: ago(1) },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent || '').not.toMatch(/\/\//)
    },
}
