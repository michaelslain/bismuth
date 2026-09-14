// Visual spec for <DaemonPanel> — the shared frame every daemon-page panel (crons, services,
// inbox, log) composes: eyebrow title + count + optional actions over a scrolling body.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import DaemonPanel from './DaemonPanel'
import { TextButton } from '../ui/TextButton'
import EmptyState from '../ui/EmptyState'

const meta = {
    title: 'Daemon/DaemonPanel',
    component: DaemonPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonPanel>

export default meta
type Story = StoryObj<typeof meta>

/** A populated panel: title + count, a handful of plain rows filling the scrolling body. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '280px', height: '220px' }}>
            <DaemonPanel title="services" count={4}>
                <div style={{ padding: '4px 12px' }}>
                    {Array.from({ length: 4 }, (_, i) => (
                        <div style={{ padding: '4px 0' }}>service-{i + 1}</div>
                    ))}
                </div>
            </DaemonPanel>
        </div>
    ),
}

/** A trailing actions slot beside the title (a bulk action, mirroring the inbox's "APPROVE
 *  ALL"). */
export const WithActions: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel
                title="needs review"
                count={2}
                actions={<TextButton size="sm">APPROVE ALL</TextButton>}
            >
                <div style={{ padding: '4px 12px' }}>two pages waiting</div>
            </DaemonPanel>
        </div>
    ),
}

/** No count passed — the badge is omitted entirely, and the body holds an EmptyState. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel title="log">
                <EmptyState>nothing logged yet</EmptyState>
            </DaemonPanel>
        </div>
    ),
}

/** The body overflows its fixed height — proves the panel itself stays put (border/height
 *  unchanged) while only the body scrolls. */
export const OverflowingBody: Story = {
    render: () => (
        <div style={{ width: '280px', height: '160px' }}>
            <DaemonPanel title="log" count={40}>
                <div style={{ padding: '4px 12px' }}>
                    {Array.from({ length: 40 }, (_, i) => (
                        <div style={{ padding: '4px 0' }}>row {i + 1}</div>
                    ))}
                </div>
            </DaemonPanel>
        </div>
    ),
}
