// Visual spec for <DaemonInbox> — the daemon page's inbox section: a flat list (due, failed,
// scheduled — no group headings) over `pages` (a plain prop, not a module-level signal — see
// DaemonInbox.tsx), with a trailing "N resolved" more-line over done/dismissed pages that opens
// the section. Box stories sit in a 420px frame; Full stories show the opened section's body.
// Row presses hit /daemon/pages/archive, which the shared fakeTransport acks generically.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, within } from 'storybook/test'
import DaemonInbox from './DaemonInbox'
import TextButton from '../ui/TextButton'
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
        <div style={{ width: '420px', height: '480px' }}>
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
        <div style={{ width: '420px', height: '260px' }}>
            <DaemonInbox pages={[]} onOpen={() => {}} onChanged={() => {}} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
    },
}

/** Nothing open, but two resolved pages — count badge reads 0, the empty line still shows, and
 *  "2 resolved" appears beneath it as a line that opens the section. */
export const EmptyWithResolved: Story = {
    render: () => (
        <div style={{ width: '420px', height: '360px' }}>
            <DaemonInbox
                pages={RESOLVED_ONLY}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const section = canvasElement.querySelector('[data-testid="daemon-section-inbox"]')!
        const badge = within(section as HTMLElement).getByText('0')
        await expect(badge).toBeInTheDocument()
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: /2 resolved/ }),
        ).toBeInTheDocument()
        await expect(
            canvas.queryByText('Memory consolidation complete'),
        ).toBeNull()
    },
}

/** A row-limited list — 6 open pages + 2 resolved, `limit={3}` shows 3 open rows plus
 *  `+3 more`, then the separate `2 resolved` line; both open the section. */
let opened = 0
export const Limited: Story = {
    render: () => {
        const openPages: DaemonPage[] = Array.from({ length: 6 }, (_, i) => ({
            path: `.daemon/pages/page-${i}.md`,
            slug: `page-${i}`,
            title: `Open page ${i}`,
            createdAt: new Date(NOW - (i + 1) * HOUR).toISOString(),
            source: 'cron:example',
            actions: [],
            body: 'placeholder',
            status: 'pending' as const,
        }))
        const pages = [...openPages, ...RESOLVED_ONLY]
        return (
            <div style={{ width: '420px', height: '480px' }}>
                <DaemonInbox
                    pages={pages}
                    onOpen={() => {}}
                    onChanged={() => {}}
                    limit={3}
                    onOpenSection={() => (opened += 1)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvasElement.querySelectorAll('[data-testid="inbox-row"]').length,
        ).toBe(3)
        const more = canvas.getByRole('button', { name: /\+3 more/ })
        await expect(more).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: /2 resolved/ }),
        ).toBeInTheDocument()
        await userEvent.click(more)
        await expect(opened).toBe(1)
        await expect(
            canvasElement.querySelectorAll('[data-testid="inbox-row"]').length,
        ).toBe(3)
    },
}

/** A failed page alongside open + resolved ones — the failed page reads as one plain row, no
 *  retry button, and the box shows only an "N resolved" line, never resolved rows. */
export const FailedAndResolved: Story = {
    render: () => (
        <div style={{ width: '420px', height: '480px' }}>
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
        await expect(
            canvas.getByRole('button', { name: /resolved/ }),
        ).toBeInTheDocument()
    },
}

/** The opened section's body: every open row, then a faint `resolved` sub-heading and every
 *  resolved row. No DaemonSection of its own. */
export const Full: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <DaemonInbox
                variant="full"
                pages={[...sampleDaemonPages(), SCHEDULED_PAGE]}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvasElement.querySelector('[data-testid="daemon-inbox-full"]'),
        ).not.toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-section-inbox"]'),
        ).toBeNull()
        await expect(canvas.getByText('resolved')).toBeInTheDocument()
        await expect(
            canvas.getByText('Memory consolidation complete'),
        ).toBeInTheDocument()
        // Row titles do not tie with the section's bold heading, and a resolved row is inked
        // quieter than an open one.
        const open = getComputedStyle(canvas.getByText('Calendar sync failed'))
        const done = getComputedStyle(
            canvas.getByText('Memory consolidation complete'),
        )
        await expect(Number(open.fontWeight)).toBeLessThan(600)
        await expect(done.color).not.toBe(open.color)
        // [archive] is a plain action, not the danger red [delete] carries.
        const probe = document.createElement('span')
        probe.style.color = 'var(--danger)'
        canvasElement.appendChild(probe)
        const danger = getComputedStyle(probe).color
        probe.remove()
        await expect(
            getComputedStyle(canvas.getAllByRole('button', { name: 'archive' })[0])
                .color,
        ).not.toBe(danger)
    },
}

/** Full with nothing open: the faint empty line, then the resolved pages. */
export const FullWithResolved: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <DaemonInbox
                variant="full"
                pages={RESOLVED_ONLY}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        await expect(canvas.getByText('resolved')).toBeInTheDocument()
        await expect(
            canvasElement.querySelectorAll('[data-testid="inbox-row"]').length,
        ).toBe(RESOLVED_ONLY.length)
    },
}

/** Box attention state is reactive: resolving the last open page drops the gold heading and
 *  the `N need you` label live. */
export const AttentionToggle: Story = {
    render: () => {
        const [pages, setPages] = createSignal<DaemonPage[]>([
            SCHEDULED_PAGE,
            ...RESOLVED_ONLY,
        ].map((p, i) => (i === 0 ? { ...p, deliverAt: undefined } : p)))
        return (
            <div style={{ width: '420px', height: '360px' }}>
                <TextButton
                    onClick={() =>
                        setPages(ps =>
                            ps.map(p =>
                                p.status === 'pending'
                                    ? { ...p, status: 'done' as const }
                                    : p,
                            ),
                        )
                    }
                >
                    resolve last open page
                </TextButton>
                <DaemonInbox
                    pages={pages()}
                    onOpen={() => {}}
                    onChanged={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvasElement.querySelectorAll('[data-testid="inbox-row"]').length,
        ).toBe(1)
        await expect(canvas.getByText('1 need you')).toBeInTheDocument()
        await userEvent.click(
            canvas.getByRole('button', { name: /resolve last open page/ }),
        )
        await expect(canvas.queryByText(/need you/)).toBeNull()
        await expect(
            canvasElement.querySelectorAll('[data-testid="inbox-row"]').length,
        ).toBe(0)
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
    },
}
