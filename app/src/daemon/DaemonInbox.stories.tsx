// Visual spec for <DaemonInbox> — the daemon page's inbox section: a flat list (due, failed,
// scheduled — no group headings) over `pages` (a plain prop, not a module-level signal — see
// DaemonInbox.tsx), with a trailing "N resolved // show" toggle over done/dismissed pages. Row
// presses hit /daemon/pages/archive, which the shared fakeTransport acks generically.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import DaemonInbox from './DaemonInbox'
import { sampleDaemonPages } from '../ui/_daemonFixtures'
import type { DaemonPage } from '../../../core/src/daemonPages'

const meta = {
    title: 'Daemon/DaemonInbox',
    component: DaemonInbox,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonInbox>

export default meta
type Story = StoryObj<typeof meta>

const NOW = Date.now()
const HOUR = 60 * 60 * 1000

const SCHEDULED_PAGE: DaemonPage = {
    path: '.daemon/pages/quarterly-report.md',
    slug: 'quarterly-report',
    title: 'Quarterly report ready in 2 days',
    createdAt: new Date(NOW - HOUR).toISOString(),
    deliverAt: new Date(NOW + 48 * HOUR).toISOString(),
    source: 'cron:quarterly-report',
    actions: [],
    body: 'Drafted, holding until the delivery date.',
    status: 'pending',
}

const RESOLVED_ONLY: DaemonPage[] = sampleDaemonPages().filter(
    p => p.status === 'done' || p.status === 'dismissed',
)

/** A due page, a failed page and a scheduled (not-yet-due) page — one flat list, no group
 *  headings anywhere. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '360px', height: '480px' }}>
            <DaemonInbox
                pages={[...sampleDaemonPages(), SCHEDULED_PAGE]}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('3 reply drafts ready'),
        ).toBeInTheDocument()
        await expect(
            canvas.getByText('Calendar sync failed'),
        ).toBeInTheDocument()
        await expect(
            canvas.getByText('Quarterly report ready in 2 days'),
        ).toBeInTheDocument()
        await expect(canvas.queryByText(/Needs review/)).toBeNull()
        await expect(canvas.queryByText(/^Failed$/)).toBeNull()
        await expect(canvas.queryByText(/Scheduled/)).toBeNull()
    },
}

/** No pages at all — the section's own empty line. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '360px', height: '260px' }}>
            <DaemonInbox pages={[]} onOpen={() => {}} onChanged={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
    },
}

/** Nothing open, but two resolved pages — count badge reads 0, the empty line still shows, and
 *  "2 resolved // show" appears beneath it, expanding to the two rows on click. */
export const EmptyWithResolved: Story = {
    render: () => (
        <div style={{ width: '360px', height: '360px' }}>
            <DaemonInbox
                pages={RESOLVED_ONLY}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const section = canvasElement.querySelector('[data-section="inbox"]')!
        const badge = within(section as HTMLElement).getByText('0')
        await expect(badge).toBeInTheDocument()
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        const toggle = canvas.getByRole('button', { name: /2 resolved/ })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        await expect(
            canvas.queryByText('Memory consolidation complete'),
        ).toBeNull()
        await userEvent.click(toggle)
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
        await expect(canvas.getByText(/hide/)).toBeInTheDocument()
        await expect(
            canvas.getByText('Memory consolidation complete'),
        ).toBeInTheDocument()
    },
}

/** A failed page alongside open + resolved ones — the failed page reads as one plain row, no
 *  retry button, and "N resolved // show" is the only way to reveal the resolved rows. */
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
        await expect(
            canvas.getByText('Calendar sync failed'),
        ).toBeInTheDocument()
        await expect(canvas.queryByRole('button', { name: /retry/ })).toBeNull()
        const toggle = canvas.getByRole('button', { name: /resolved/ })
        await expect(toggle).toHaveAttribute('aria-expanded', 'false')
        toggle.focus()
        await userEvent.keyboard('{Enter}')
        await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    },
}
