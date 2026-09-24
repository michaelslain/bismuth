// Visual spec for <DaemonCrons> — the presentational crons panel. Every callback records its
// call instead of fetching (`fn()` from storybook/test), per the presentational-panel rule: this
// component never imports `api`/stores itself, so nothing here needs a fake backend.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import DaemonCrons from './DaemonCrons'
import { sampleDaemonSnapshot } from '../ui/_daemonFixtures'

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
    onCreate: fn(async () => {}),
    onDelete: fn(async () => {}),
}

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
 *  actions columns off the edge. */
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
}

/** `[ new cron ]` swapped for the inline name field. */
export const Creating: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonCrons {...baseProps} crons={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const newCronBtn = canvas.getByRole('button', { name: 'new cron' })
        // The panel head's own actions are hidden at rest too.
        const actions = canvasElement.querySelector<HTMLElement>(
            '[class*="daemon-panel-actions"]',
        )!
        await expect(getComputedStyle(actions).opacity).toBe('0')
        await userEvent.click(newCronBtn)
        await expect(
            canvas.getByRole('textbox', { name: 'new cron name' }),
        ).toBeInTheDocument()
    },
}

/** A rejected create (409-style name clash) shows its message inline under the field, and stays
 *  in the create state so the name can be adjusted and retried. */
export const CreateError: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonCrons
                {...baseProps}
                crons={[]}
                onCreate={fn(async () => {
                    throw new Error('a cron named "dream" already exists')
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: 'new cron' }))
        await userEvent.type(
            canvas.getByRole('textbox', { name: 'new cron name' }),
            'dream',
        )
        await userEvent.keyboard('{Enter}')
        await expect(
            canvas.getByText('a cron named "dream" already exists'),
        ).toBeInTheDocument()
        // The field must still be alive after a rejected create — Esc cancels it.
        await userEvent.keyboard('{Escape}')
        await expect(
            canvas.getByRole('button', { name: 'new cron' }),
        ).toBeInTheDocument()
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
                        schedule: '0 7 * * *',
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
        await expect(canvas.getByText('no crons')).toBeInTheDocument()
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
