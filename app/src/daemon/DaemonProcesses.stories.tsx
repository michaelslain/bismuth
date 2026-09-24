// Visual spec for <DaemonProcesses> — the presentational services panel. Same shape as
// DaemonCrons.stories.tsx minus running/failed (a service has no discrete run state) plus the
// same create/delete/empty/offline matrix.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import DaemonProcesses from './DaemonProcesses'
import { sampleDaemonSnapshot } from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/DaemonProcesses',
    component: DaemonProcesses,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonProcesses>

export default meta
type Story = StoryObj<typeof meta>

const SNAPSHOT = sampleDaemonSnapshot()

const baseProps = {
    daemonRunning: true,
    onOpen: fn(),
    onToggle: fn(),
    onCreate: fn(async () => {}),
    onDelete: fn(async () => {}),
}

/** A mix of enabled (glowing, "on") and disabled ("off", dimmed) services. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonProcesses {...baseProps} processes={SNAPSHOT.processes} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('on')).toBeInTheDocument()
        // DaemonProcesses rows have no `[ run ]`, but a row's actions cell is still the same
        // DaemonRow.tsx primitive — no reveal to test without an `actions` prop supplied.
        // Acceptance 5: a services row with no actions renders no actions cell at all (DaemonRow's
        // `<Show when={props.actions !== undefined}>`) and the list's grid drops the whole track
        // (`.list` vs `.list.with-actions` in DaemonProcesses.module.css), so every row's status
        // word is its last painted cell.
        const rows = [
            ...canvasElement.querySelectorAll<HTMLElement>('[class*="row"]'),
        ]
        await expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            await expect(row.querySelector('[class*="actions"]')).toBeNull()
            // The status word is the row's LAST rendered cell whenever it has no actions — safer
            // than matching by class, since ui/StatusDot's own `.status-dot` class also contains
            // the substring "status".
            const status = row.lastElementChild as HTMLElement
            const gap = row.getBoundingClientRect().right - status.getBoundingClientRect().right
            await expect(gap).toBeLessThanOrEqual(2)
        }
    },
}

/** A disabled service (`enabled: false`) — reads "off" and dims, regardless of whether the
 *  daemon process itself is running (see `DaemonOffline` below for that, separate, axis). */
export const Disabled: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonProcesses
                {...baseProps}
                processes={[
                    { name: 'sync-worker', file: 'sync-worker', enabled: false, running: false },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('off')).toBeInTheDocument()
    },
}

/** A service name long enough that it must ellipsize instead of pushing status/actions off the
 *  edge. */
export const LongName: Story = {
    render: () => (
        <div style={{ width: '220px', height: '120px' }}>
            <DaemonProcesses
                {...baseProps}
                processes={[
                    {
                        name: 'background-vault-reindexing-and-embedding-worker',
                        file: 'reindex-worker',
                        enabled: true,
                        running: false,
                    },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const name = canvas.getByText(
            'background-vault-reindexing-and-embedding-worker',
        )
        // Real clipping, not just presence: the text overflows its own box (DaemonRow.module.css's
        // `.name` caps the column's `max-content` track sizing at 28ch) and Label's ellipsis trio
        // is in effect.
        await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
        await expect(getComputedStyle(name).textOverflow).toBe('ellipsis')
        // …with the status word still fully inside the row, not pushed off the edge by the
        // un-clipped name.
        await expect(canvas.getByText('on')).toBeInTheDocument()
        const row = name.closest<HTMLElement>('[class*="row"]')!
        const status = row.lastElementChild as HTMLElement
        const rowRect = row.getBoundingClientRect()
        const statusRect = status.getBoundingClientRect()
        await expect(statusRect.right).toBeLessThanOrEqual(rowRect.right + 1)
        await expect(statusRect.left).toBeGreaterThanOrEqual(rowRect.left)
    },
}

/** `[ new service ]` swapped for the inline name field. */
export const Creating: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonProcesses {...baseProps} processes={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const newServiceBtn = canvas.getByRole('button', { name: 'new service' })
        // The panel head's own actions are hidden at rest too.
        const actions = canvasElement.querySelector<HTMLElement>(
            '[class*="daemon-panel-actions"]',
        )!
        await expect(getComputedStyle(actions).opacity).toBe('0')
        await userEvent.click(newServiceBtn)
        await expect(
            canvas.getByRole('textbox', { name: 'new service name' }),
        ).toBeInTheDocument()
    },
}

/** A rejected create shows its message inline under the field and stays in the create state. */
export const CreateError: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonProcesses
                {...baseProps}
                processes={[]}
                onCreate={fn(async () => {
                    throw new Error('a service named "sync-worker" already exists')
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(
            canvas.getByRole('button', { name: 'new service' }),
        )
        await userEvent.type(
            canvas.getByRole('textbox', { name: 'new service name' }),
            'sync-worker',
        )
        await userEvent.keyboard('{Enter}')
        await expect(
            canvas.getByText('a service named "sync-worker" already exists'),
        ).toBeInTheDocument()
        // The field must still be alive after a rejected create — Esc cancels it.
        await userEvent.keyboard('{Escape}')
        await expect(
            canvas.getByRole('button', { name: 'new service' }),
        ).toBeInTheDocument()
    },
}

/** The row's context menu → Delete swaps the trailing action for an inline `[ delete ] [
 *  cancel ]` confirm — no modal. */
export const ConfirmDelete: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonProcesses
                {...baseProps}
                processes={[
                    { name: 'sync-worker', file: 'sync-worker', enabled: true, running: false },
                ]}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // The menu portals to document.body — query it there, not inside canvasElement.
        const body = within(document.body)
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: canvas.getByText('sync-worker'),
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

/** No background services configured. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonProcesses {...baseProps} processes={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('no background services'),
        ).toBeInTheDocument()
    },
}

/** The daemon process itself is offline — every enabled service must show idle/faint, not
 *  glowing accent. */
export const DaemonOffline: Story = {
    render: () => (
        <div style={{ width: '360px', height: '120px' }}>
            <DaemonProcesses
                {...baseProps}
                daemonRunning={false}
                processes={SNAPSHOT.processes}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('on')).toBeInTheDocument()
        const dots = [
            ...canvasElement.querySelectorAll<HTMLElement>('[class*="dot-wrap"]'),
        ]
        await expect(dots.length).toBeGreaterThan(0)
        for (const dot of dots) {
            await expect(getComputedStyle(dot).boxShadow).toBe('none')
        }
    },
}
