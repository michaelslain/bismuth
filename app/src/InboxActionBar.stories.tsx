// Visual spec for <InboxActionBar> — the bar pinned under an inbox page: hairline on top, content
// in the note column, status dot + phrase on the left, the page's buttons on the right with the
// primary (`selected`, accent) LAST. Each story is a 1300px pane with a 760px note column.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
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
    onMarkFailed: noop,
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

/** Pending: `waiting on you`, then dismiss, then approve (primary) last at the right. */
export const Pending: Story = {
    args: base,
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/waiting on you/)
        const buttons = [...canvasElement.querySelectorAll('button')]
        await expect(buttons.length).toBe(2)
        await expect(buttons[buttons.length - 1].textContent).toContain(
            'submit',
        )
        await expect(buttons[1].getBoundingClientRect().left).toBeGreaterThan(
            buttons[0].getBoundingClientRect().left,
        )
        await expect(
            buttons[1].getBoundingClientRect().right,
        ).toBeGreaterThan(buttons[0].getBoundingClientRect().right)
    },
}

/** Working: the phrase, every button disabled. */
export const Working: Story = {
    args: { ...base, page: WORKING },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/working…/)
    },
}

/** Stuck: the offline warning + [mark failed], no dot phrase. */
export const Stuck: Story = {
    args: { ...base, page: WORKING, stuck: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/daemon may be offline/)
        await expect(text(canvasElement)).toMatch(/mark failed/)
    },
}

/** Stuck on a device that is not the owner. */
export const StuckNotOwner: Story = {
    args: { ...base, page: WORKING, stuck: true, notOwner: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/approval never fired/)
    },
}

/** Pending on a non-owner device: the warning replaces the phrase, buttons stay. */
export const NotOwner: Story = {
    args: { ...base, notOwner: true },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/isn't the daemon owner/)
        await expect(text(canvasElement)).not.toMatch(/waiting on you/)
    },
}

/** Failed: `failed // <note>` with the retry button still live. */
export const Failed: Story = {
    args: { ...base, page: FAILED },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/failed \/\//)
        await expect(canvasElement.querySelectorAll('button').length).toBe(1)
    },
}

/** Done: the note, no buttons. */
export const Done: Story = {
    args: { ...base, page: DONE },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/done \/\//)
        await expect(canvasElement.querySelectorAll('button').length).toBe(0)
    },
}

/** Dismissed: the age, no buttons. */
export const Dismissed: Story = {
    args: { ...base, page: DISMISSED },
    play: async ({ canvasElement }) => {
        await expect(text(canvasElement)).toMatch(/dismissed \/\//)
        await expect(canvasElement.querySelectorAll('button').length).toBe(0)
    },
}

/** The page record has not arrived yet: the hairline and an empty row, no crash. */
export const NoPage: Story = {
    args: { ...base, page: undefined },
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelector('[data-testid="inbox-page-actions"]'),
        ).not.toBeNull()
        await expect(canvasElement.querySelectorAll('button').length).toBe(0)
    },
}
