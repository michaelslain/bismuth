// Visual spec for <DaemonLog> — the daemon page's activity log panel: one mono row per event,
// newest first, toned by activityLine.ts's ActivityTone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import DaemonLog from './DaemonLog'
import { sampleActivity } from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/DaemonLog',
    component: DaemonLog,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonLog>

export default meta
type Story = StoryObj<typeof meta>

/** 12 events spanning every kind (cron/process/daemon/session) and outcome, so every tone
 *  (fail/live/quiet/ok) and duration bucket (<1s/Ns/Nm) appears at once. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '420px', height: '360px' }}>
            <DaemonLog events={sampleActivity()} />
        </div>
    ),
}

/** No activity yet — the panel's shared EmptyState. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '420px', height: '160px' }}>
            <DaemonLog events={[]} />
        </div>
    ),
}
