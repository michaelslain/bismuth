// Visual spec for <DaemonLog> — the daemon page's activity log panel: one mono row per event,
// newest first, toned by activityLine.ts's ActivityTone.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
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
    canvasElement.querySelectorAll('[data-testid="daemon-log-row"]')

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

/** A row-limited list — 30 events, `limit={10}` shows the newest 10 plus `+20 more`, which
 *  opens the section (it never expands inline). */
let opened = 0
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
                <DaemonLog
                    events={events}
                    limit={10}
                    onOpenSection={() => (opened += 1)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(logRows(canvasElement).length).toBe(10)
        const more = canvas.getByRole('button', { name: /\+20 more/ })
        await expect(more).toBeInTheDocument()
        await userEvent.click(more)
        await expect(opened).toBe(1)
        await expect(logRows(canvasElement).length).toBe(10)
    },
}

/** The opened section's body: events across three days grouped under faint day labels. */
export const Full: Story = {
    render: () => {
        const at = (daysAgo: number, hour: number, i: number): ActivityEvent => {
            const d = new Date()
            d.setDate(d.getDate() - daysAgo)
            d.setHours(hour, 0, 0, 0)
            return {
                ts: d.toISOString(),
                kind: 'cron',
                name: `job-${i}`,
                event: 'finished',
                outcome: 'success',
                durationMs: 1000,
            }
        }
        const events = [
            at(0, 1, 0),
            at(0, 0, 1),
            at(1, 20, 2),
            at(1, 9, 3),
            at(3, 14, 4),
        ]
        return (
            <div style={{ width: '420px' }}>
                <DaemonLog variant="full" events={events} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvasElement.querySelector('[data-testid="daemon-log-full"]'),
        ).not.toBeNull()
        await expect(canvas.getByText('today')).toBeInTheDocument()
        await expect(canvas.getByText('yesterday')).toBeInTheDocument()
        await expect(logRows(canvasElement).length).toBe(5)
    },
}

/** Every event's owner that still has a definition — `[ open ]` shows for these crons/services. */
const definitionFor = (e: ActivityEvent) =>
    e.kind === 'cron' || e.kind === 'process'
        ? `.daemon/${e.kind === 'cron' ? 'crons' : 'processes'}/${e.name}.md`
        : undefined

/** Clicking a row's line unfolds its detail: the exact time // kind // duration, the daemon's
 *  detail text (here the failure), and `[ only answer-emails ]` `[ open ]`. A second click folds it. */
export const Expanded: Story = {
    args: { onOpen: fn() },
    render: args => (
        <div style={{ width: '420px' }}>
            <DaemonLog
                events={sampleActivity()}
                definitionFor={definitionFor}
                onOpen={args.onOpen}
            />
        </div>
    ),
    play: async ({ canvasElement, args }) => {
        const canvas = within(canvasElement)
        const first = logRows(canvasElement)[0] as HTMLElement
        const line = first.querySelector('button')!
        await userEvent.click(line)
        await expect(line.getAttribute('aria-expanded')).toBe('true')
        const detail = within(first).getByTestId('daemon-log-detail')
        await expect(within(detail).getByText('the gmail api timed out twice')).toBeInTheDocument()
        await expect(within(detail).getByText(/cron \/\/ 4\.2s/)).toBeInTheDocument()
        await userEvent.click(within(detail).getByRole('button', { name: /open/ }))
        await expect(args.onOpen).toHaveBeenCalledWith('.daemon/crons/answer-emails.md')
        // One open at a time: opening another row folds the first.
        await userEvent.click((logRows(canvasElement)[3] as HTMLElement).querySelector('button')!)
        await expect(canvas.getAllByTestId('daemon-log-detail')).toHaveLength(1)
        await expect(line.getAttribute('aria-expanded')).toBe('false')
    },
}

const filterOpened = fn()

/** `[ only answer-emails ]` narrows the log to that cron, under an `only answer-emails //
 *  [ clear ]` line; `[ clear ]` brings every event back. The box stays a box throughout. */
export const Filtered: Story = {
    render: () => {
        const events = [
            ...sampleActivity(),
            {
                ts: new Date(NOW - 3 * 60 * MIN).toISOString(),
                kind: 'cron',
                name: 'answer-emails',
                event: 'finished',
                outcome: 'success',
                durationMs: 3100,
            },
        ]
        return (
            <div style={{ width: '420px' }}>
                <DaemonLog events={events} onOpenSection={filterOpened} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        filterOpened.mockClear()
        const total = logRows(canvasElement).length
        await userEvent.click((logRows(canvasElement)[0] as HTMLElement).querySelector('button')!)
        await userEvent.click(canvas.getByRole('button', { name: /only answer-emails/ }))
        await expect(canvas.getByTestId('daemon-log-filter')).toBeInTheDocument()
        const owned = sampleActivity().filter(e => e.name === 'answer-emails').length + 1
        await expect(logRows(canvasElement).length).toBe(owned)
        await userEvent.click(canvas.getByRole('button', { name: /clear/ }))
        await expect(logRows(canvasElement).length).toBe(total)
        // Neither button opens the section, though each unmounts before its click bubbles to the box.
        await expect(filterOpened).not.toHaveBeenCalled()
    },
}

/** Why each run began and how it ended, opened: a self-reported failure with its reason and the
 *  run's report line, a timeout, a skip, a start on schedule. The opened log wraps the note, so
 *  the long reason reads whole instead of clipping. */
export const Reasons: Story = {
    render: () => {
        const at = (min: number) => new Date(NOW - min * MIN).toISOString()
        const events: ActivityEvent[] = [
            {
                ts: at(1),
                kind: 'cron',
                name: 'dream',
                event: 'finished',
                outcome: 'failed',
                cause: 'job',
                durationMs: 16583,
                detail: 'the housing note is still oversized and I did not rewrite it',
                summary: 'vault=5 memory=1 transcripts=1 merged=0 pages=0 notes=140',
            },
            {
                ts: at(2),
                kind: 'cron',
                name: 'dream',
                event: 'started',
                detail: 'catching up on a missed run // haiku',
            },
            {
                ts: at(30),
                kind: 'cron',
                name: 'vault-review',
                event: 'finished',
                outcome: 'killed',
                cause: 'timeout',
                durationMs: 600000,
                detail: 'aborted after 600s',
            },
            {
                ts: at(60),
                kind: 'cron',
                name: 'dream',
                event: 'skipped',
                outcome: 'skipped',
                detail: 'skipped: no changes since 2026-10-12T18:17:52-07:00',
            },
        ]
        return (
            <div style={{ width: '420px' }}>
                <DaemonLog variant="full" events={events} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText(/^the housing note is still oversized/),
        ).toBeInTheDocument()
        await expect(
            canvas.getByText('no changes since 2026-10-12T18:17:52-07:00'),
        ).toBeInTheDocument()
    },
}

/** What the doctor repaired, as the boot pass and `bismuth doctor --fix` log it: one `doctor` row per
 *  repair, its note the finding id, what it did and where the backup went. A destructive repair
 *  names its backup commit; a failed one carries its first warning. */
export const DoctorRepairs: Story = {
    render: () => {
        const at = (min: number) => new Date(NOW - min * MIN).toISOString()
        const events: ActivityEvent[] = [
            {
                ts: at(1),
                kind: 'doctor',
                name: 'doctor',
                event: 'repair',
                outcome: 'success',
                detail: 'legacy.claude-bot-service // unload and delete ~/Library/LaunchAgents/com.claude-bot.plist // backup 3f9c2ab in ~/.bismuth/doctor-backups',
            },
            {
                ts: at(1),
                kind: 'doctor',
                name: 'doctor',
                event: 'repair',
                outcome: 'success',
                detail: 'daemon.atomic-tmp // unlink 4 leftover temp files',
            },
            {
                ts: at(1),
                kind: 'doctor',
                name: 'doctor',
                event: 'repair',
                outcome: 'failed',
                detail: 'install.version-skew // rerun the installer // EACCES: permission denied, open /usr/local/bin/bismuth',
            },
        ]
        return (
            <div style={{ width: '420px' }}>
                <DaemonLog variant="full" events={events} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(logRows(canvasElement).length).toBe(3)
        await expect(
            canvas.getByText(/^legacy\.claude-bot-service \/\/ unload/),
        ).toBeInTheDocument()
    },
}
