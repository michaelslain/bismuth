// app/src/daemon/DaemonOverview.stories.tsx
// Visual spec for <DaemonOverview> — the daemon page's right-column stack (inbox, crons,
// services, log). Each slot here is a plain <DaemonSection> holding `Text` stand-in rows; the
// real list components (DaemonInbox, DaemonCrons, DaemonProcesses, DaemonLog) compose their own
// DaemonSection and are proven in their own story files, never imported here.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { For, type JSX } from 'solid-js'
import DaemonOverview from './DaemonOverview'
import DaemonSection from './DaemonSection'
import Text from '../ui/Text'

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

function rows(n: number, label: string) {
    return (
        <For each={Array.from({ length: n }, (_, i) => i)}>
            {i => (
                <Row>
                    {label} {i + 1}
                </Row>
            )}
        </For>
    )
}

const assertSectionOrder = (canvasElement: HTMLElement) => {
    const sections = Array.from(
        canvasElement.querySelectorAll<HTMLElement>('[data-testid^="daemon-section-"]'),
    )
    return sections.map(el => el.dataset.testid!.replace('daemon-section-', ''))
}

export const AllFilled: Story = {
    render: () => (
        <Frame width="900px" height="1200px">
            <DaemonOverview
                inbox={
                    <DaemonSection title="inbox" count={2} empty="nothing needs you" isEmpty={false}>
                        {rows(2, 'page')}
                    </DaemonSection>
                }
                crons={
                    <DaemonSection title="crons" count={3} empty="no crons yet // ask the daemon" isEmpty={false}>
                        {rows(3, 'cron')}
                    </DaemonSection>
                }
                services={
                    <DaemonSection title="services" count={2} empty="no services yet // ask the daemon" isEmpty={false}>
                        {rows(2, 'service')}
                    </DaemonSection>
                }
                log={
                    <DaemonSection title="log" empty="nothing logged yet" isEmpty={false} fill>
                        {rows(12, 'event')}
                    </DaemonSection>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
    },
}

export const AllEmpty: Story = {
    render: () => (
        <Frame width="900px" height="1200px">
            <DaemonOverview
                inbox={<DaemonSection title="inbox" count={0} empty="nothing needs you" isEmpty />}
                crons={<DaemonSection title="crons" count={0} empty="no crons yet // ask the daemon" isEmpty />}
                services={<DaemonSection title="services" count={0} empty="no services yet // ask the daemon" isEmpty />}
                log={<DaemonSection title="log" empty="nothing logged yet" isEmpty fill />}
            />
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

export const LongLog: Story = {
    render: () => (
        // Bounded, not 1200px: the log only has to scroll (Acceptance 11) when the frame can't
        // just grow to fit all 60 rows.
        <Frame width="900px" height="600px">
            <DaemonOverview
                inbox={
                    <DaemonSection title="inbox" count={2} empty="nothing needs you" isEmpty={false}>
                        {rows(2, 'page')}
                    </DaemonSection>
                }
                crons={
                    <DaemonSection title="crons" count={3} empty="no crons yet // ask the daemon" isEmpty={false}>
                        {rows(3, 'cron')}
                    </DaemonSection>
                }
                services={
                    <DaemonSection title="services" count={2} empty="no services yet // ask the daemon" isEmpty={false}>
                        {rows(2, 'service')}
                    </DaemonSection>
                }
                log={
                    <DaemonSection title="log" empty="nothing logged yet" isEmpty={false} fill>
                        {rows(60, 'event')}
                    </DaemonSection>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const logSection = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-section-log"]')!
        const body = logSection.querySelector<HTMLElement>(':scope > div:last-child')!
        await expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
        // The other three sections stay intact — still present with their full row counts.
        await expect(canvas.getAllByText(/^page \d+$/).length).toBe(2)
        await expect(canvas.getAllByText(/^cron \d+$/).length).toBe(3)
        await expect(canvas.getAllByText(/^service \d+$/).length).toBe(2)
    },
}

export const TallTopSections: Story = {
    render: () => (
        <Frame width="900px" height="700px">
            <DaemonOverview
                inbox={
                    <DaemonSection title="inbox" count={5} empty="nothing needs you" isEmpty={false}>
                        {rows(5, 'page')}
                    </DaemonSection>
                }
                crons={
                    <DaemonSection title="crons" count={12} empty="no crons yet // ask the daemon" isEmpty={false}>
                        {rows(12, 'cron')}
                    </DaemonSection>
                }
                services={
                    <DaemonSection title="services" count={8} empty="no services yet // ask the daemon" isEmpty={false}>
                        {rows(8, 'service')}
                    </DaemonSection>
                }
                log={
                    <DaemonSection title="log" empty="nothing logged yet" isEmpty={false} fill>
                        {rows(20, 'event')}
                    </DaemonSection>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const root = getComputedStyle(document.documentElement)
        const rowH = parseFloat(root.getPropertyValue('--row-h'))
        const sp1 = parseFloat(root.getPropertyValue('--sp-1'))
        const sp2 = parseFloat(root.getPropertyValue('--sp-2'))
        // 8 real (padded) rows plus the section heading's own row + its gap to the first row —
        // matches `.logSlot`'s `min-height` in DaemonOverview.module.css.
        const floor = (rowH + 2 * sp1) * 8 + rowH + sp2
        const logSection = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-section-log"]')!
        await expect(logSection.offsetHeight).toBeGreaterThanOrEqual(floor)
    },
}

export const Narrow: Story = {
    render: () => (
        <Frame width="480px" height="1200px" containerType>
            <DaemonOverview
                inbox={
                    <DaemonSection title="inbox" count={2} empty="nothing needs you" isEmpty={false}>
                        {rows(2, 'page')}
                    </DaemonSection>
                }
                crons={
                    <DaemonSection title="crons" count={3} empty="no crons yet // ask the daemon" isEmpty={false}>
                        {rows(3, 'cron')}
                    </DaemonSection>
                }
                services={
                    <DaemonSection title="services" count={2} empty="no services yet // ask the daemon" isEmpty={false}>
                        {rows(2, 'service')}
                    </DaemonSection>
                }
                log={
                    <DaemonSection title="log" empty="nothing logged yet" isEmpty={false} fill>
                        {rows(60, 'event')}
                    </DaemonSection>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(assertSectionOrder(canvasElement)).toEqual(['inbox', 'crons', 'services', 'log'])
        const rowH = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--row-h'),
        )
        const logSection = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-section-log"]')!
        // Narrow caps the log slot at ~10 rows — well short of the 60 it's holding.
        await expect(logSection.offsetHeight).toBeLessThan(20 * rowH)
    },
}
