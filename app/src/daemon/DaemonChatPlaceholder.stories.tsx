// Visual spec for <DaemonChatPlaceholder> — the daemon page's chat band before a user gesture arms
// the real chat. Inert by design: it mounts no ChatView and opens no session.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent } from 'storybook/test'
import DaemonChatPlaceholder from './DaemonChatPlaceholder'
import { daemonChatArmed, armDaemonChat } from '../daemonChatArm'

const meta = {
    title: 'Daemon/DaemonChatPlaceholder',
    component: DaemonChatPlaceholder,
} satisfies Meta<typeof DaemonChatPlaceholder>

export default meta
type Story = StoryObj<typeof meta>

/** The band at its dock height: one composer-shaped box pinned to the bottom. */
export const Band: Story = {
    render: () => (
        <div
            style={{ height: '220px', width: '100%' }}
            onPointerDown={e => armDaemonChat(e)}
            onFocusIn={e => armDaemonChat(e)}
        >
            <DaemonChatPlaceholder />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const root = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-placeholder"]',
        )
        await expect(root).not.toBeNull()
        const box = root!.querySelector<HTMLElement>('[role="button"]')!
        await expect(box.textContent).toContain('ask the daemon')
        // Pinned to the band's bottom, inside the 680px column.
        const r = root!.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        await expect(r.bottom - b.bottom).toBeLessThanOrEqual(19)
        await expect(b.width).toBeLessThanOrEqual(680)
        await expect(b.height).toBeGreaterThan(0)
        // A script cannot arm the chat: dispatched presses and focus events are untrusted. (Not
        // `box.focus()` — the focus events the browser fires for a script's focus() call ARE
        // trusted, which is why nothing in the app may programmatically focus this box.)
        await fireEvent.pointerDown(box)
        await fireEvent.focusIn(box)
        await expect(daemonChatArmed()).toBe(false)
        await expect(canvasElement.querySelector('[data-chat-host]')).toBeNull()
    },
}
