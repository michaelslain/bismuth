// Visual spec for <InboxMessageHeader> — the head over an inbox page's own message: `daemon` in
// sage, `// <source>`, the age at the trailing edge — the same line every reply in the thread
// carries. 1300px pane, 760px note column, like the page it sits on.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import InboxMessageHeader from './InboxMessageHeader'

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()

const meta = {
    title: 'App/InboxMessageHeader',
    component: InboxMessageHeader,
    parameters: { layout: 'fullscreen' },
    render: args => (
        <div style={{ width: 'min(1300px, 100%)', '--note-column': '760px' }}>
            <InboxMessageHeader {...args} />
        </div>
    ),
} satisfies Meta<typeof InboxMessageHeader>

export default meta
type Story = StoryObj<typeof meta>

/** From a cron: the source after `daemon`, the cron prefix dropped. */
export const FromCron: Story = {
    args: { page: { source: 'cron:answer-emails', createdAt: ago(2) } },
    play: async ({ canvasElement }) => {
        const t = canvasElement.textContent || ''
        await expect(t).toMatch(/daemon\s*\/\/ answer-emails/)
        await expect(t).toMatch(/2h ago/)
    },
}

/** A request filed from an email you sent. */
export const FromEmail: Story = {
    args: { page: { source: 'email', createdAt: ago(0.1) } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent || '').toMatch(/daemon\s*\/\/ email/)
    },
}

/** No source: `daemon` alone. */
export const NoSource: Story = {
    args: { page: { createdAt: ago(26) } },
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent || '').not.toMatch(/\/\//)
    },
}
