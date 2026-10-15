// Visual spec for <InboxActionBar> — the end of an inbox page's transcript: the page's buttons as
// bracket chips (primary, `selected`, LAST), then the `>` reply prompt. A page that takes no reply
// right now ends with one status line instead. Warnings and a failure note sit above the chips. Each story is a 1300px pane with a 760px note column.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent } from 'storybook/test'
import InboxActionBar from './InboxActionBar'
import type { InboxActionBarProps } from './InboxActionBar'
import { sampleDaemonPages } from './ui/_daemonFixtures'

const [PENDING, WORKING, DONE, FAILED] = sampleDaemonPages()
const DISMISSED = {
    ...DONE,
    status: 'dismissed' as const,
    daemonNote: undefined,
    pressedAt: new Date(Date.now() - 3 * 3600e3).toISOString(),
}

const noop = () => {}
const base: InboxActionBarProps = {
    page: PENDING,
    notOwner: false,
    stuck: false,
    pressingId: null,
    onPress: noop,
    onReply: noop,
    onMarkFailed: noop,
}

const field = (el: HTMLElement) =>
    el.querySelector<HTMLTextAreaElement>('[data-testid="inbox-reply-input"]')

const ASKING = {
    ...PENDING,
    thread: [
        { from: 'you' as const, text: 'maybe hold the one to Sam', at: new Date().toISOString(), via: 'app' as const },
        {
            from: 'daemon' as const,
            text: 'Send the other two now and keep the reply to Sam as a draft?',
            at: new Date().toISOString(),
        },
    ],
}
const READING = {
    ...PENDING,
    status: 'working' as const,
    replying: true,
    pressedAt: new Date().toISOString(),
}

const meta = {
    title: 'App/InboxActionBar',
    component: InboxActionBar,
    parameters: { layout: 'fullscreen' },
    render: args => (
        <div style={{ width: 'min(1300px, 100%)', '--note-column': '760px' }}>
            <InboxActionBar {...args} />
        </div>
    ),
} satisfies Meta<typeof InboxActionBar>

export default meta
type Story = StoryObj<typeof meta>

const text = (el: HTMLElement) => el.textContent || ''
const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')]

/** Pending: the chips — dismiss, then the primary approve — then the prompt with its hint. */
export const Pending: Story = {
    args: base,
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/enter sends/)
        await expect(field(canvasElement)?.placeholder).toBe('reply in your own words')
        await expect(field(canvasElement)?.tagName).toBe('TEXTAREA')
        const b = buttons(canvasElement)
        await expect(b.length).toBe(2)
        await expect(b[1].textContent).toContain('submit')
        await expect(b[1].getBoundingClientRect().left).toBeGreaterThan(
            b[0].getBoundingClientRect().right,
        )
        // the chips come first, the prompt under them
        await expect(field(canvasElement)!.getBoundingClientRect().top).toBeGreaterThan(
            b[0].getBoundingClientRect().bottom,
        )
    },
}

/** Typing adds a `send` button beside the prompt; the confirm key sends and clears, and
 *  Shift+Enter is a new line. */
export const ReplyTyped: Story = {
    args: { ...base, onReply: fn() },
    play: async ({ canvasElement, args }) => {
        const input = field(canvasElement)!
        await userEvent.type(input, 'send them{Shift>}{Enter}{/Shift}but keep the one to Sam')
        await expect(input.value).toBe('send them\nbut keep the one to Sam')
        await expect(buttons(canvasElement).map(b => b.textContent)).toEqual([
            'dismiss',
            'submit',
            'send',
        ])
        await userEvent.keyboard('{Enter}')
        await expect(args.onReply).toHaveBeenCalledWith('send them\nbut keep the one to Sam')
        await expect(input.value).toBe('')
        await expect(buttons(canvasElement).length).toBe(2)
        input.blur()
    },
}

/** The daemon asked back: the same chips and prompt; the question itself is in the thread above,
 *  not repeated here. */
export const Asking: Story = {
    args: { ...base, page: ASKING },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).not.toMatch(/keep the reply to Sam/)
        await expect(buttons(canvasElement).length).toBe(2)
        await expect(field(canvasElement)).not.toBeNull()
    },
}

/** The daemon is reading a reply: one status line, no box. */
export const ReadingReply: Story = {
    args: {
        ...base,
        page: { ...READING, thread: [{ from: 'you' as const, text: 'yes but say Q3 is fine', at: new Date().toISOString(), via: 'email' as const }] },
    },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/reading your reply…/)
        await expect(field(canvasElement)).toBeNull()
    },
}

/** Working: the phrase, nothing to press. */
export const Working: Story = {
    args: { ...base, page: WORKING },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/working…/)
        await expect(buttons(canvasElement).length).toBe(0)
    },
}

/** Stuck: the offline warning above, [mark failed] on the status line. */
export const Stuck: Story = {
    args: { ...base, page: WORKING, stuck: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/daemon may be offline/)
        await expect(buttons(canvasElement).map(b => b.textContent)).toEqual(['mark failed'])
    },
}

/** Stuck on a device that is not the owner. */
export const StuckNotOwner: Story = {
    args: { ...base, page: WORKING, stuck: true, notOwner: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/approval never fired/)
    },
}

/** Pending on a non-owner device: the warning above, the chips, no prompt. */
export const NotOwner: Story = {
    args: { ...base, notOwner: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/isn't the daemon owner/)
        await expect(field(canvasElement)).toBeNull()
        await expect(buttons(canvasElement).length).toBe(2)
    },
}

/** Failed: `failed // <note>` above, the retry chip, and the prompt to retry or redirect. */
export const Failed: Story = {
    args: { ...base, page: FAILED },
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelector('[data-testid="inbox-page-note"]')?.textContent,
        ).toMatch(/^failed \/\//)
        await expect(field(canvasElement)?.placeholder).toBe('reply to retry, or say what to change')
        await expect(buttons(canvasElement).length).toBe(1)
    },
}

/** Done: the note, no buttons. */
export const Done: Story = {
    args: { ...base, page: DONE },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/done \/\//)
        await expect(buttons(canvasElement).length).toBe(0)
    },
}

/** Dismissed: the age, no buttons. */
export const Dismissed: Story = {
    args: { ...base, page: DISMISSED },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/dismissed \/\//)
        await expect(buttons(canvasElement).length).toBe(0)
    },
}

/** The page record has not arrived yet: the hairline alone, no crash. */
export const NoPage: Story = {
    args: { ...base, page: undefined },
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelector('[data-testid="inbox-page-actions"]'),
        ).not.toBeNull()
        await expect(buttons(canvasElement).length).toBe(0)
    },
}
