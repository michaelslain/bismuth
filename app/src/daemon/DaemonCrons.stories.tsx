// Visual spec for <DaemonCrons> — the presentational crons panel. Every callback records its
// call instead of fetching (`fn()` from storybook/test), per the presentational-panel rule: this
// component never imports `api`/stores itself, so nothing here needs a fake backend.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonInbox from './DaemonInbox'
import DaemonLog from './DaemonLog'
import {
    sampleActivity,
    sampleDaemonPages,
    sampleDaemonSnapshot,
} from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/DaemonCrons',
    component: DaemonCrons,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonCrons>

export default meta
type Story = StoryObj<typeof meta>

const SNAPSHOT = sampleDaemonSnapshot()

const baseProps = {
    daemonRunning: true,
    onOpen: fn(),
    onRun: fn(),
    onToggle: fn(),
    onDelete: fn(async () => {}),
}

const onOpenSection = fn()

/** A mix of statuses — ok, running, failed, disabled, and a file-change trigger. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '420px', height: '260px' }}>
            <DaemonCrons {...baseProps} crons={SNAPSHOT.crons} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('morning-brief')).toBeInTheDocument()
        // `[ run ]` is hidden at rest and reveals on that row's own :focus-within.
        const row = canvasElement.querySelector<HTMLElement>('[tabindex="0"]')!
        const actionsBox = row.querySelector<HTMLElement>('[class*="actions"]')!
        await expect(getComputedStyle(actionsBox).opacity).toBe('0')
        row.focus()
        await waitFor(() => expect(getComputedStyle(actionsBox).opacity).toBe('1'))
    },
}

/** A single cron currently executing — glowing accent dot, `running` status text, `[ run ]`
 *  disabled (the daemon ignores a run trigger for an already-running job). */
export const Running: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'morning-brief',
                        file: 'morning-brief',
                        schedule: '0 7 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: true,
                        lastFired: null,
                        running: true,
                        startedAt: new Date().toISOString(),
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('running')).toBeInTheDocument()
    },
}

/** A cron whose last run failed (or was killed — failedResult.ts unifies the two) — danger-
 *  toned "failed Nh ago" text, not colour alone. */
export const Failed: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'dream',
                        file: 'dream',
                        schedule: '0 3 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: true,
                        lastFired: {
                            timestamp: new Date(
                                Date.now() - 2 * 60 * 60 * 1000,
                            ).toISOString(),
                            result: 'killed',
                        },
                        running: false,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/failed/)).toBeInTheDocument()
    },
}

/** A disabled cron definition — the whole row dims, status reads `off`. */
export const Disabled: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'nightly-backup',
                        file: 'nightly-backup',
                        schedule: '0 2 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: false,
                        lastFired: null,
                        running: false,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('off')).toBeInTheDocument()
    },
}

/** A cron name long enough that it must ellipsize instead of pushing the schedule/status/
 *  actions columns off the edge — and the schedule, the first thing to give, still keeps a
 *  readable stub (its track floors at 8ch) and its full text in a `title`. */
export const LongName: Story = {
    render: () => (
        <div style={{ width: '260px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'reconcile-every-vault-notes-inbound-link-graph-nightly',
                        file: 'reconcile-nightly',
                        schedule: '0 3 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: true,
                        lastFired: null,
                        running: false,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-row"]',
        )!
        const meta = row.querySelector<HTMLElement>('[title]')!
        await expect(meta.getAttribute('title')).toBe(meta.textContent)
        const em = parseFloat(getComputedStyle(meta).fontSize)
        // 8ch of this face is at least ~4em; the floor must hold at this squeezed width.
        await expect(meta.getBoundingClientRect().width).toBeGreaterThan(em * 4)
    },
}

/** A 40-char file-change trigger next to `failed 10m ago` — the schedule cell ellipsizes and
 *  never crowds the status, which stays flush against the list's right edge (Acceptance 5, 9). */
export const LongSchedule: Story = {
    render: () => (
        <div style={{ width: '340px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'reindex',
                        file: 'reindex',
                        schedule: '',
                        on: 'file-change',
                        watch: 'notes/**/inbox/**/*.md and attachments/**/*',
                        enabled: true,
                        lastFired: {
                            timestamp: new Date(
                                Date.now() - 10 * 60 * 1000,
                            ).toISOString(),
                            result: 'failed',
                        },
                        running: false,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const schedule = canvas.getByText(/^on change:/)
        await expect(schedule.scrollWidth).toBeGreaterThan(
            schedule.clientWidth,
        )
        await expect(schedule.getAttribute('title')).toBe(schedule.textContent)
        // The schedule keeps a readable stub even beside a long name + status.
        await expect(
            schedule.getBoundingClientRect().width,
        ).toBeGreaterThan(parseFloat(getComputedStyle(schedule).fontSize) * 4)
        const status = canvas.getByText('failed 10m ago')
        const list = canvasElement.querySelector<HTMLElement>(
            '[class*="cronsList"]',
        )!
        const sp4 = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
                '--sp-4',
            ),
        )
        const statusRect = status.getBoundingClientRect()
        const listRect = list.getBoundingClientRect()
        await expect(
            Math.abs(
                statusRect.right - (listRect.right - sp4),
            ),
        ).toBeLessThanOrEqual(1)
    },
}

/** The row's context menu → Delete swaps the trailing action for an inline `[ delete ] [
 *  cancel ]` confirm — no modal. */
export const ConfirmDelete: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[
                    {
                        name: 'morning-brief',
                        file: 'morning-brief',
                        schedule: '',
                        on: 'file-change',
                        watch: 'notes/journal/**/daily/*.md',
                        enabled: true,
                        lastFired: null,
                        running: false,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The menu portals to document.body (Portal + Solid, same as ContextMenu.stories.tsx /
        // TaskChip.stories.tsx), so it must be queried there, not inside canvasElement.
        const body = within(document.body)
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: canvas.getByText('morning-brief'),
        })
        const menuDelete = await waitFor(() => body.getByText('Delete'))
        await userEvent.click(menuDelete)
        const deleteBtn = canvas.getByRole('button', { name: 'delete' })
        const cancelBtn = canvas.getByRole('button', { name: 'cancel' })
        await expect(deleteBtn).toBeInTheDocument()
        await expect(cancelBtn).toBeInTheDocument()
        // The exception: a row mid inline-delete-confirm keeps its actions visible, no hover
        // or focus needed — DaemonRow's `data-confirming`.
        const actionsBox = deleteBtn.closest<HTMLElement>('[class*="actions"]')!
        await waitFor(() => expect(getComputedStyle(actionsBox).opacity).toBe('1'))
        // The confirm overlay is ~17ch wide, wider than the status cell alone — a long
        // schedule/trigger must be hidden too, not just the status word.
        await expect(
            getComputedStyle(canvas.getByText(/^on change:/)).visibility,
        ).toBe('hidden')
    },
}

/** A row-limited list — 8 crons with the 6th failed. `limit={3}` shows the failed one first
 *  (attentionFirst) plus 2 more, then `+5 more`; clicking it calls onOpenSection (the host
 *  opens the full-screen section). The count badge always reads the full total, never the limited count. */
export const Limited: Story = {
    render: () => {
        const crons = Array.from({ length: 8 }, (_, i) => ({
            name: `cron-${i}`,
            file: `cron-${i}`,
            schedule: '0 7 * * *',
            on: 'schedule' as const,
            watch: null,
            enabled: true,
            lastFired:
                i === 5
                    ? {
                          timestamp: new Date(
                              Date.now() - 2 * 60 * 60 * 1000,
                          ).toISOString(),
                          result: 'failed' as const,
                      }
                    : {
                          timestamp: new Date(
                              Date.now() - 10 * 60 * 1000,
                          ).toISOString(),
                          result: 'success' as const,
                      },
            running: false,
            startedAt: null,
        }))
        return (
            <div style={{ width: '360px', height: '260px' }}>
                <DaemonCrons
                    {...baseProps}
                    crons={crons}
                    limit={3}
                    {...{ onOpenSection }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const rowNames = () =>
            [
                ...canvasElement.querySelectorAll<HTMLElement>(
                    '[data-testid="daemon-row"]',
                ),
            ].map(r => r.textContent ?? '')
        await expect(rowNames().length).toBe(3)
        await expect(rowNames()[0]).toContain('cron-5')
        const badge = within(
            canvasElement.querySelector('[data-testid="daemon-section-crons"]') as HTMLElement,
        ).getByText('8')
        await expect(badge).toBeInTheDocument()
        const more = canvas.getByRole('button', { name: /\+5 more/ })
        await expect(more).toBeInTheDocument()
        // The opener hands off to the host (full-screen section) — it no longer expands in place.
        await userEvent.click(more)
        await expect(onOpenSection).toHaveBeenCalled()
        await expect(rowNames().length).toBe(3)
    },
}

/** The opened section's list — every row (12 crons), no box of its own, at takeover width. */
export const Full: Story = {
    render: () => {
        const crons = Array.from({ length: 12 }, (_, i) => ({
            name: `cron-${i}`,
            file: `cron-${i}`,
            schedule: i % 3 === 0 ? '*/15 * * * *' : '0 7 * * 1-5',
            on: 'schedule' as const,
            watch: null,
            enabled: i !== 4,
            lastFired: {
                timestamp: new Date(Date.now() - (i + 1) * 10 * 60 * 1000).toISOString(),
                result: i === 2 ? ('failed' as const) : ('success' as const),
            },
            running: false,
            startedAt: null,
        }))
        return (
            <div style={{ width: '100%', 'max-width': '1300px' }}>
                <DaemonCrons {...baseProps} variant="full" crons={crons} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const list = canvasElement.querySelector('[data-testid="daemon-crons-full"]')!
        await expect(list.getAttribute('data-variant')).toBe('full')
        await expect(list.querySelectorAll('[data-testid="daemon-row"]').length).toBe(12)
        await expect(canvasElement.querySelector('[data-testid="daemon-section-crons"]')).toBeNull()
    },
}

/** Nothing configured and the section opened anyway: the opened body says so instead of a
 *  blank takeover. */
export const FullEmpty: Story = {
    render: () => (
        <div style={{ width: '100%', 'max-width': '1300px' }}>
            <DaemonCrons {...baseProps} variant="full" crons={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('no crons yet // ask the daemon'),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-crons-full"]'),
        ).toBeNull()
    },
}

/** The four opened lists (crons, services, inbox, log) at takeover width: ONE measure
 *  (`--daemon-list-max`), so every list ends at the same x and its trailing column (status, age,
 *  duration) sits in the same place. */
export const OpenedListsShareMeasure: Story = {
    render: () => (
        <div
            data-testid="measure-stack"
            style={{ width: '100%', 'max-width': '1500px' }}
        >
            <DaemonCrons
                {...baseProps}
                variant="full"
                crons={SNAPSHOT.crons}
            />
            <DaemonProcesses
                variant="full"
                daemonRunning
                onOpen={fn()}
                onToggle={fn()}
                onDelete={fn(async () => {})}
                processes={SNAPSHOT.processes}
            />
            <DaemonInbox
                variant="full"
                pages={sampleDaemonPages()}
                onOpen={fn()}
                onChanged={fn()}
            />
            <DaemonLog variant="full" events={sampleActivity()} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const q = (id: string) =>
            canvasElement.querySelector<HTMLElement>(`[data-testid="${id}"]`)!
        const lists = [
            q('daemon-crons-full'),
            q('daemon-processes-full'),
            q('daemon-inbox-full'),
            q('daemon-log-full'),
        ]
        const right = lists[0].getBoundingClientRect().right
        for (const l of lists)
            await expect(
                Math.abs(l.getBoundingClientRect().right - right),
            ).toBeLessThanOrEqual(1)
        // The cap really bites at this width: the stack is wider than one measure.
        await expect(
            q('measure-stack').getBoundingClientRect().right - right,
        ).toBeGreaterThan(40)
        // And the trailing text of each list ends inside that edge by the same inset.
        const trailing = [
            lists[0].querySelector<HTMLElement>('[data-testid="daemon-row"] > :nth-child(4)')!,
            lists[1].querySelector<HTMLElement>('[data-testid="daemon-row"] > :nth-child(3)')!,
            lists[2].querySelector<HTMLElement>('[data-testid="inbox-row"] button > :last-child')!,
            lists[3].querySelector<HTMLElement>('[class*="log-row"] > :last-child')!,
        ]
        const sp4 = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--sp-4'),
        )
        // Where the TEXT ends: the box's right edge minus its own right padding (a services
        // status carries the row's inset as padding, the other three as margin or the row).
        for (const t of trailing) {
            const end =
                t.getBoundingClientRect().right -
                parseFloat(getComputedStyle(t).paddingRight)
            await expect(Math.abs(end - (right - sp4))).toBeLessThanOrEqual(1)
        }
    },
}

/** No crons configured. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons {...baseProps} crons={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('no crons yet // ask the daemon')).toBeInTheDocument()
    },
}

/** The daemon process itself is offline — a cron whose `running` flag is stale must NOT show
 *  as live; the dot/status fall back to idle rather than trusting `cron.running` alone. */
export const DaemonOffline: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                daemonRunning={false}
                crons={[
                    {
                        name: 'morning-brief',
                        file: 'morning-brief',
                        schedule: '0 7 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: true,
                        lastFired: null,
                        running: true,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.queryByText('running')).toBeNull()
    },
}

/** The daemon process is offline AND the stale `running` flag's cron actually fired before it
 *  went down — the status must fall back to that last result ('ok 3h ago') rather than 'never',
 *  which would read as "this has never once run" and is simply false. */
export const StaleRunningOffline: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonCrons
                {...baseProps}
                daemonRunning={false}
                crons={[
                    {
                        name: 'morning-brief',
                        file: 'morning-brief',
                        schedule: '0 7 * * *',
                        on: 'schedule',
                        watch: null,
                        enabled: true,
                        lastFired: {
                            timestamp: new Date(
                                Date.now() - 3 * 60 * 60 * 1000,
                            ).toISOString(),
                            result: 'success',
                        },
                        running: true,
                        startedAt: null,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const status = canvas.getByText(/^ok /)
        await expect(status.textContent).not.toBe('never')
    },
}
