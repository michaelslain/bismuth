// app/src/daemon/DaemonOverview.stories.tsx
// Visual spec for <DaemonOverview> — the daemon page's right-column stack (inbox, crons,
// services, log), ONE scroll for the whole column. Each slot here is a plain stub section holding
// `Text` stand-in rows that honours its own `limit()` accessor (slice + a `DaemonMoreLine`) —
// the real list components (DaemonInbox, DaemonCrons, DaemonProcesses, DaemonLog) do the same
// thing for real and are proven in their own story files, never imported here.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { createSignal, For, Show, type JSX } from 'solid-js'
import DaemonOverview, { type DaemonOverviewProps, type DaemonSectionKey } from './DaemonOverview'
import DaemonSection from './DaemonSection'
import DaemonMoreLine from './DaemonMoreLine'
import Text from '../ui/Text'
import type { RowLimit } from './daemonRowBudget'

const meta = {
    title: 'Daemon/DaemonOverview',
    component: DaemonOverview,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonOverview>

export default meta
type Story = StoryObj<typeof meta>

function Frame(props: { width: string; height: string; containerType?: boolean; children: JSX.Element }) {
    return (
        <div
            style={{
                width: props.width,
                height: props.height,
                'max-width': '100%',
                ...(props.containerType ? { 'container-type': 'size' } : {}),
            }}
        >
            {props.children}
        </div>
    )
}

function Row(props: { children: JSX.Element }) {
    return (
        <Text as="div" size="ui">
            {props.children}
        </Text>
    )
}

function items(n: number, label: string): string[] {
    return Array.from({ length: n }, (_, i) => `${label} ${i + 1}`)
}

/** A stub section over plain strings that honours its own `limit()` accessor exactly like the
 *  real list components: slice to the limit, and a `+N more // show` line that expands in place. */
function StubSection(props: {
    title: string
    count?: number
    empty: string
    rows: string[]
    limit: () => RowLimit
}) {
    const [open, setOpen] = createSignal(false)
    const limited = () => {
        const l = props.limit()
        return l !== undefined && props.rows.length > l
    }
    const shown = () => {
        const l = props.limit()
        return l === undefined || open() ? props.rows : props.rows.slice(0, l)
    }
    return (
        <DaemonSection
            title={props.title}
            count={props.count}
            empty={props.empty}
            isEmpty={props.rows.length === 0}
        >
            <For each={shown()}>{r => <Row>{r}</Row>}</For>
            <Show when={limited()}>
                <DaemonMoreLine
                    label={
                        open()
                            ? `all ${props.rows.length}`
                            : `+${props.rows.length - (props.limit() as number)} more`
                    }
                    open={open()}
                    onToggle={() => setOpen(v => !v)}
                />
            </Show>
        </DaemonSection>
    )
}

function buildRows(
    counts: Record<DaemonSectionKey, number>,
    attention: Partial<Record<DaemonSectionKey, number>> = {},
): DaemonOverviewProps['rows'] {
    return {
        inbox: { total: counts.inbox, attention: attention.inbox ?? 0 },
        crons: { total: counts.crons, attention: attention.crons ?? 0 },
        services: { total: counts.services, attention: attention.services ?? 0 },
        log: { total: counts.log, attention: attention.log ?? 0 },
    }
}

function overviewProps(counts: Record<DaemonSectionKey, number>): DaemonOverviewProps {
    return {
        rows: buildRows(counts),
        inbox: limit => (
            <StubSection
                title="inbox"
                count={counts.inbox}
                empty="nothing needs you"
                rows={items(counts.inbox, 'page')}
                limit={limit}
            />
        ),
        crons: limit => (
            <StubSection
                title="crons"
                count={counts.crons}
                empty="no crons yet // ask the daemon"
                rows={items(counts.crons, 'cron')}
                limit={limit}
            />
        ),
        services: limit => (
            <StubSection
                title="services"
                count={counts.services}
                empty="no services yet // ask the daemon"
                rows={items(counts.services, 'service')}
                limit={limit}
            />
        ),
        log: limit => (
            <StubSection title="log" empty="nothing logged yet" rows={items(counts.log, 'event')} limit={limit} />
        ),
    }
}

const assertSectionOrder = (canvasElement: HTMLElement) => {
    const sections = Array.from(
        canvasElement.querySelectorAll<HTMLElement>('[data-testid^="daemon-section-"]'),
    )
    return sections.map(el => el.dataset.testid!.replace('daemon-section-', ''))
}

/** Small totals, a tall frame: everything fits at rest — no more-lines, no scroll. */
export const AllFit: Story = {
    render: () => (
        <Frame width="900px" height="1200px">
            <DaemonOverview {...overviewProps({ inbox: 2, crons: 3, services: 2, log: 12 })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const overview = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-overview"]')!
        await expect(overview.scrollHeight).toBeLessThanOrEqual(overview.clientHeight + 1)
        await expect(canvasElement.querySelectorAll('[data-testid="daemon-more-line"]').length).toBe(0)
    },
}

/** Big totals in a squeezed ~600px frame: every heading still visible, no scroll, more-lines
 *  appear, and no section is starved below its floor of 3 rows. */
export const Squeezed: Story = {
    render: () => (
        <Frame width="900px" height="600px">
            <DaemonOverview {...overviewProps({ inbox: 8, crons: 12, services: 10, log: 60 })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const overview = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-overview"]')!
        await expect(overview.scrollHeight).toBeLessThanOrEqual(overview.clientHeight + 1)
        await expect(canvas.getByText('inbox')).toBeInTheDocument()
        await expect(canvas.getByText('crons')).toBeInTheDocument()
        await expect(canvas.getByText('services')).toBeInTheDocument()
        await expect(canvas.getByText('log')).toBeInTheDocument()
        await expect(
            canvasElement.querySelectorAll('[data-testid="daemon-more-line"]').length,
        ).toBeGreaterThan(0)
        await expect(canvas.getAllByText(/^page \d+$/).length).toBeGreaterThanOrEqual(3)
        await expect(canvas.getAllByText(/^cron \d+$/).length).toBeGreaterThanOrEqual(3)
        await expect(canvas.getAllByText(/^service \d+$/).length).toBeGreaterThanOrEqual(3)
        await expect(canvas.getAllByText(/^event \d+$/).length).toBeGreaterThanOrEqual(3)
    },
}

export const AllEmpty: Story = {
    render: () => (
        <Frame width="900px" height="1200px">
            <DaemonOverview {...overviewProps({ inbox: 0, crons: 0, services: 0, log: 0 })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        await expect(canvas.getByText('nothing needs you')).toBeInTheDocument()
        await expect(canvas.getByText('no crons yet // ask the daemon')).toBeInTheDocument()
        await expect(canvas.getByText('no services yet // ask the daemon')).toBeInTheDocument()
        await expect(canvas.getByText('nothing logged yet')).toBeInTheDocument()
    },
}

/** Narrow: static per-section caps (measuring this component's own auto height would be a
 *  feedback loop there) — the log caps at 10 regardless of how much room is on screen. */
export const Narrow: Story = {
    render: () => (
        <Frame width="480px" height="1200px" containerType>
            <DaemonOverview {...overviewProps({ inbox: 2, crons: 3, services: 2, log: 60 })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const canvas = within(canvasElement)
        await expect(canvas.getAllByText(/^event \d+$/).length).toBe(10)
    },
}
