// Visual spec for <InboxReplyField> — the `>` reply prompt at the end of an inbox page's
// transcript: a sage `>`, a field in the messages' prose face that grows a line at a time, the
// send hint under it, and a `send` button once there is text.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent } from 'storybook/test'
import InboxReplyField from './InboxReplyField'

const HINT = 'enter sends // shift+enter new line'

const meta = {
    title: 'App/InboxReplyField',
    component: InboxReplyField,
    parameters: { layout: 'centered' },
    render: args => (
        <div style={{ width: '620px' }}>
            <InboxReplyField {...args} />
        </div>
    ),
} satisfies Meta<typeof InboxReplyField>

export default meta
type Story = StoryObj<typeof meta>

const input = (el: HTMLElement) =>
    el.querySelector<HTMLTextAreaElement>('[data-testid="inbox-reply-input"]')!
const labels = (el: HTMLElement) => [...el.querySelectorAll('button')].map(b => b.textContent)

/** Empty: the prompt, the placeholder, the hint; no button. */
export const Empty: Story = {
    args: { placeholder: 'reply in your own words', hint: HINT, onSubmit: fn() },
    play: async ({ canvasElement }) => {
        await expect(input(canvasElement).placeholder).toBe('reply in your own words')
        await expect(canvasElement.textContent).toMatch(/^>/)
        await expect(canvasElement.textContent).toContain(HINT)
        await expect(labels(canvasElement)).toEqual([])
    },
}

/** With text: `send` appears, sends, and the field clears. A blank reply sends nothing. */
export const Typed: Story = {
    args: { placeholder: 'reply in your own words', hint: HINT, onSubmit: fn() },
    play: async ({ canvasElement, args }) => {
        await userEvent.type(input(canvasElement), '   ')
        await expect(labels(canvasElement)).toEqual([])
        await userEvent.type(input(canvasElement), 'yes, send all three')
        await expect(labels(canvasElement)).toEqual(['send'])
        // `send` is the field's one emphasised action (`primary`), not a toggle that is on
        const sendBtn = canvasElement.querySelector('button')!
        await expect(sendBtn.hasAttribute('data-primary')).toBe(true)
        await expect(sendBtn.getAttribute('data-state')).toBe('normal')
        await userEvent.click(canvasElement.querySelector('button')!)
        await expect(args.onSubmit).toHaveBeenCalledWith('yes, send all three')
        await expect(input(canvasElement).value).toBe('')
        input(canvasElement).blur()
    },
}

/** A long reply: the field grows a line at a time; Shift+Enter is a new line, Enter sends. */
export const LongReply: Story = {
    args: { placeholder: 'reply in your own words', hint: HINT, onSubmit: fn() },
    play: async ({ canvasElement, args }) => {
        const el = input(canvasElement)
        const before = el.getBoundingClientRect().height
        await userEvent.type(el, 'yes{Shift>}{Enter}{/Shift}but tell Jane Q3 is fine{Shift>}{Enter}{/Shift}and hold Sam')
        await expect(el.getBoundingClientRect().height).toBeGreaterThan(before)
        await userEvent.keyboard('{Enter}')
        await expect(args.onSubmit).toHaveBeenCalledWith('yes\nbut tell Jane Q3 is fine\nand hold Sam')
        el.blur()
    },
}

/** Disabled while a press or reply is in flight. */
export const Disabled: Story = {
    args: { placeholder: 'reply in your own words', hint: HINT, disabled: true, onSubmit: fn() },
    play: async ({ canvasElement }) => {
        await expect(input(canvasElement).disabled).toBe(true)
    },
}
