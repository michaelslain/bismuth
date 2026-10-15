// Visual spec for <InboxThread> — the replies after an inbox page's draft: your replies and the
// daemon's questions, oldest first, each opening with a hairline, then the sender line, then the
// words in the draft's own type. 760px wide, the note column it sits in.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import InboxThread from './InboxThread'

const ago = (m: number) => new Date(Date.now() - m * 60e3).toISOString()

const meta = {
    title: 'App/InboxThread',
    component: InboxThread,
    parameters: { layout: 'centered' },
    render: args => (
        <div style={{ width: '760px' }}>
            <InboxThread {...args} />
        </div>
    ),
} satisfies Meta<typeof InboxThread>

export default meta
type Story = StoryObj<typeof meta>

/** A reply by email, the daemon asking back, and the answer from the app. */
export const Conversation: Story = {
    args: {
        entries: [
            { from: 'you', text: 'maybe hold the one to Sam', at: ago(12), via: 'email' },
            { from: 'daemon', text: 'Send the other two now and keep the reply to Sam as a draft?', at: ago(11) },
            { from: 'you', text: 'yes', at: ago(1), via: 'app' },
        ],
    },
    play: async ({ canvasElement }) => {
        const items = canvasElement.querySelectorAll('li')
        await expect(items.length).toBe(3)
        await expect(items[0].textContent).toMatch(/by email/)
        await expect(items[2].textContent).not.toMatch(/by email/)
        await expect(items[1].getAttribute('data-from')).toBe('daemon')
    },
}

/** A long reply wraps in the prose face and keeps its line breaks. */
export const LongReply: Story = {
    args: {
        entries: [
            {
                from: 'you',
                text: 'send the one to Jane but tell her Q3 is fine and to ship it on Monday.\nhold the reply to Sam until I have looked at his numbers, and drop the one to the recruiter entirely.',
                at: ago(3),
                via: 'app',
            },
        ],
    },
    play: async ({ canvasElement }) => {
        const words = canvasElement.querySelector('li p') as HTMLElement
        await expect(getComputedStyle(words).whiteSpace).toBe('pre-wrap')
        await expect(words.getBoundingClientRect().height).toBeGreaterThan(40)
    },
}
