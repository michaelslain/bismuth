// Visual spec for <DaemonLog> — the daemon page's activity log panel: one mono row per event,
// newest first, toned by activityLine.ts's ActivityTone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import DaemonLog from './DaemonLog'
import { sampleActivity } from '../ui/_daemonFixtures'
import type { ActivityEvent } from '../../../core/src/daemonActivity'

const meta = {
    title: 'Daemon/DaemonLog',
    component: DaemonLog,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonLog>

export default meta
type Story = StoryObj<typeof meta>

const logRows = (canvasElement: HTMLElement) =>
    canvasElement.querySelectorAll('[class*="log-row"]')

/** 12 events spanning every kind (cron/process/daemon/session) and outcome, so every tone
 *  (fail/live/quiet/ok) and duration bucket (<1s/Ns/Nm) appears at once. No `limit`, so the
 *  section sizes to its content — the right column, not this section, owns the scroll now. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <DaemonLog events={sampleActivity()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(logRows(canvasElement).length).toBe(12)
    },
}

/** No activity yet — the section's own empty line. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '420px' }}>
            <DaemonLog events={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('nothing logged yet')).toBeInTheDocument()
        await expect(logRows(canvasElement).length).toBe(0)
    },
}

const NOW = Date.now()
const MIN = 60 * 1000

/** A row-limited list — 30 events, `limit={10}` shows the newest 10 plus `+20 more // show`;
 *  clicking it reveals all 30 with `all 30 // hide`. */
export const Limited: Story = {
    render: () => {
        const events: ActivityEvent[] = Array.from({ length: 30 }, (_, i) => ({
            ts: new Date(NOW - i * MIN).toISOString(),
            kind: 'cron',
            name: `job-${i}`,
            event: 'finished',
            outcome: 'success',
            durationMs: 1000,
        }))
        return (
            <div style={{ width: '420px' }}>
                <DaemonLog events={events} limit={10} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(logRows(canvasElement).length).toBe(10)
        const more = canvas.getByRole('button', { name: /\+20 more/ })
        await expect(more).toBeInTheDocument()
        await userEvent.click(more)
        await expect(logRows(canvasElement).length).toBe(30)
        await expect(canvas.getByRole('button', { name: /all 30/ })).toBeInTheDocument()
    },
}
