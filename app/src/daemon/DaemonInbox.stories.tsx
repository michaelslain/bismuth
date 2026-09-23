// Visual spec for <DaemonInbox> — the daemon page's inbox panel: Needs review / Failed /
// Scheduled / Recently resolved sections over `pages` (now a plain prop, not a module-level signal — see
// DaemonInbox.tsx). Row presses hit /daemon/pages/resolve, which the shared fakeTransport acks
// generically.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import DaemonInbox from './DaemonInbox'
import { sampleDaemonPages } from '../ui/_daemonFixtures'
import type { DaemonPage, PageAction } from '../../../core/src/daemonPages'

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

const APPROVE: PageAction = {
    id: 'approve',
    label: 'Approve',
    kind: 'primary',
    prompt: 'Go ahead.',
}
const DISMISS: PageAction = { id: 'dismiss', label: 'Dismiss', kind: 'default' }
const now = Date.now()
const HOUR = 60 * 60 * 1000

/** Three due pages sharing the SAME single primary action id — the only shape that surfaces
 *  the "APPROVE ALL" button (sharedPrimaryAction() in daemonInboxLogic.ts requires 2+ pages
 *  agreeing on one primary action). */
const manyDue = (): DaemonPage[] => [
        {
            path: '.daemon/pages/reply-1.md',
            slug: 'reply-1',
            title: 'Reply to Jordan re: lease renewal',
            createdAt: new Date(now - 3 * HOUR).toISOString(),
            source: 'cron:answer-emails',
            actions: [APPROVE, DISMISS],
            body: 'Drafted a reply confirming the September 1st renewal date.',
            status: 'pending',
        },
        {
            path: '.daemon/pages/reply-2.md',
            slug: 'reply-2',
            title: 'Reply to the internship recruiter',
            createdAt: new Date(now - 2 * HOUR).toISOString(),
            source: 'cron:answer-emails',
            actions: [APPROVE, DISMISS],
            body: 'Drafted a reply confirming interview availability next week.',
            status: 'pending',
        },
        {
            path: '.daemon/pages/reply-3.md',
            slug: 'reply-3',
            title: 'Reply to the book club thread',
            createdAt: new Date(now - 1 * HOUR).toISOString(),
            source: 'cron:answer-emails',
            actions: [APPROVE, DISMISS],
            body: "Drafted a reply with this month's pick.",
            status: 'pending',
        },
    ]

export const ManyDueWithApproveAll: Story = {
    render: () => (
        <div style={{ width: '360px', height: '480px' }}>
            <DaemonInbox pages={manyDue()} onOpen={() => {}} onChanged={() => {}} />
        </div>
    ),
}

/** The first APPROVE ALL press only asks: the button becomes CANCEL + CONFIRM 3 with a note
 *  that the daemon will act on every page, and focus lands on CANCEL so a stray Enter backs out.
 *  Escape (the ui-dismiss key) cancels too. */
export const ConfirmApproveAll: Story = {
    render: () => (
        <div style={{ width: '360px', height: '480px' }}>
            <DaemonInbox pages={manyDue()} onOpen={() => {}} onChanged={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: /APPROVE ALL 3/ }))
        await expect(canvas.getByRole('button', { name: /CONFIRM 3/ })).toBeInTheDocument()
        await expect(canvas.getByText(/act on all 3/)).toBeInTheDocument()
        await waitFor(() =>
            expect(canvas.getByRole('button', { name: /CANCEL/ })).toHaveFocus(),
        )
        await userEvent.keyboard('{Escape}')
        await expect(canvas.getByRole('button', { name: /APPROVE ALL 3/ })).toBeInTheDocument()
        await userEvent.click(canvas.getByRole('button', { name: /APPROVE ALL 3/ }))
    },
}

/** Failed pages get their own section with their actions live — the action that failed reads
 *  RETRY and the failure note replaces the snippet. Recently resolved keeps done/dismissed only,
 *  and its head is a real button that says whether it is expanded. */
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
        await expect(canvas.getByRole('button', { name: /RETRY/ })).toBeInTheDocument()
        const toggle = canvas.getByRole('button', { name: /Recently resolved/ })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        toggle.focus()
        await userEvent.keyboard('{Enter}')
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    },
}
