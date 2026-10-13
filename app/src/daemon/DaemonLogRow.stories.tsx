// Visual spec for <DaemonLogRow> — one daemon log event: the mono line, and the detail it unfolds.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, within } from 'storybook/test'
import DaemonLogRow from './DaemonLogRow'
import type { ActivityEvent } from '../../../core/src/daemonActivity'

const meta = {
    title: 'Daemon/DaemonLogRow',
    component: DaemonLogRow,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonLogRow>

export default meta
type Story = StoryObj<typeof meta>

const NOW = new Date()
const failed: ActivityEvent = {
    ts: new Date(NOW.getTime() - 2 * 60 * 1000).toISOString(),
    kind: 'cron',
    name: 'answer-emails',
    event: 'finished',
    outcome: 'failed',
    cause: 'schedule',
    durationMs: 4200,
    detail: 'timeout calling gmail api\n  at fetchInbox (gmail.ts:88)\n  at run (answer-emails.md)',
}

/** Folded: only the line, the way every row in the log rests. */
export const Folded: Story = {
    args: { event: failed, now: NOW, expanded: false, onToggle: fn() },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByTestId('daemon-log-detail')).toBeNull()
    },
}

/** Unfolded failure: time // kind // exact duration // cause, the multi-line error kept as
 *  written, then `[ only answer-emails ]` `[ open ]`. */
export const ExpandedFailure: Story = {
    args: {
        event: failed,
        now: NOW,
        expanded: true,
        onToggle: fn(),
        onFilter: fn(),
        onOpenDefinition: fn(),
    },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/cause schedule/)).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: /only answer-emails/ })).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: /open/ })).toBeInTheDocument()
    },
}

/** A daemon event: no owner definition and nothing to narrow to, so the detail has no actions. */
export const ExpandedNoActions: Story = {
    args: {
        event: {
            ts: NOW.toISOString(),
            kind: 'daemon',
            name: '',
            event: 'brain-started',
        },
        now: NOW,
        expanded: true,
        onToggle: fn(),
    },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryAllByRole('button')).toHaveLength(1)
    },
}
