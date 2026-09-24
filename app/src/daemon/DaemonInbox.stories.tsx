// Visual spec for <DaemonInbox> — the daemon page's inbox panel: Needs review / Failed /
// Scheduled / Recently resolved sections over `pages` (now a plain prop, not a module-level signal — see
// DaemonInbox.tsx). Row presses hit /daemon/pages/archive, which the shared fakeTransport acks
// generically.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import DaemonInbox from './DaemonInbox'
import { sampleDaemonPages } from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/DaemonInbox',
    component: DaemonInbox,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonInbox>

export default meta
type Story = StoryObj<typeof meta>

/** The fixture's full state matrix: one due page under "Needs review", nothing scheduled,
 *  three terminal pages collapsed under "Recently resolved". */
export const Default: Story = {
    render: () => (
        <div style={{ width: '360px', height: '480px' }}>
            <DaemonInbox
                pages={sampleDaemonPages()}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
}

/** No pages at all — the panel's shared EmptyState. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '360px', height: '260px' }}>
            <DaemonInbox pages={[]} onOpen={() => {}} onChanged={() => {}} />
        </div>
    ),
}

/** Failed pages get their own section, one line each, no failure-note text and no retry
 *  button — `[archive]` is the only action, same as any other row. Recently resolved keeps
 *  done/dismissed only, and its head is a real button that says whether it is expanded. */
export const FailedAndResolved: Story = {
    render: () => (
        <div style={{ width: '360px', height: '480px' }}>
            <DaemonInbox
                pages={sampleDaemonPages()}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/^Failed/)).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: /retry/ })).toBeNull()
        const toggle = canvas.getByRole('button', { name: /Recently resolved/ })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        toggle.focus()
        await userEvent.keyboard('{Enter}')
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    },
}
