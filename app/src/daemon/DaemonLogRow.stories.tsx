// Visual spec for <DaemonLogRow> — one daemon log event: the mono line, and the detail it unfolds.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
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
    file: `activity-${NOW.toISOString().slice(0, 10)}.jsonl`,
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

/** A folded row's hover `[x]` deletes the entry at once, without opening the detail or toggling
 *  the row (the host's undo toast is the way back). */
export const HoverXDeletes: Story = {
    args: {
        event: failed,
        now: NOW,
        expanded: false,
        onToggle: fn(),
        onDelete: fn(async () => {}),
    },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        // A synthetic pointer cannot raise CSS :hover, so the hover-revealed `[x]` (pointer-events
        // none until then) is clicked past that check; real hover is covered by the browser run.
        await userEvent.click(canvas.getByRole('button', { name: 'delete log entry' }), { pointerEventsCheck: 0 })
        await expect(args.onDelete).toHaveBeenCalledTimes(1)
        await expect(args.onToggle).not.toHaveBeenCalled()
        await expect(canvas.queryByRole('button', { name: /cancel/ })).toBeNull()
    },
}

/** Unfolded failure: time // kind // exact duration // cause, the log file it lives in, the
 *  multi-line error kept as written, then `[ open ]` `[ copy path ]` `[ delete ]` on that file. */
export const ExpandedFailure: Story = {
    args: {
        event: failed,
        now: NOW,
        expanded: true,
        onToggle: fn(),
        onOpenLog: fn(),
        onCopyPath: fn(),
        onDelete: fn(async () => {}),
    },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/cause schedule/)).toBeInTheDocument()
        await expect(canvas.getByText(/^\.daemon\/logs\/activity-.*\.jsonl$/)).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: /copy path/ })).toBeInTheDocument()
        await expect(canvas.getByRole('button', { name: /delete/ })).toBeInTheDocument()
    },
}

/** `[ delete ]` in the detail deletes at once, like the `[x]`; there is no second step. */
export const DetailDelete: Story = {
    args: {
        event: failed,
        now: NOW,
        expanded: true,
        onToggle: fn(),
        onOpenLog: fn(),
        onCopyPath: fn(),
        onDelete: fn(async () => {}),
    },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLogRow {...args} />
        </div>
    ),
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: /delete/ }))
        await expect(args.onDelete).toHaveBeenCalledTimes(1)
        await expect(canvas.queryByRole('button', { name: /cancel/ })).toBeNull()
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
