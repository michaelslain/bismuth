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
    onDelete: fn(async () => {}),
}

const onOpenSection = fn()

/** A mix of enabled (glowing, "on") and disabled ("off", dimmed) services. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '360px', height: '160px' }}>
            <DaemonProcesses {...baseProps} processes={SNAPSHOT.processes} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // 'on' is both an enabled row's status and a disabled row's `[ on ]` button.
        await expect(canvas.getAllByText('on').length).toBeGreaterThan(0)
        // Every services row carries an `[ off ]`/`[ on ]` actions cell, pulled out of grid flow
        // and pinned over the status word (DaemonProcesses.module.css), so the status word itself
        // stays the row's rightmost painted content, inset by --sp-4 (8px).
        const rows = [
            ...canvasElement.querySelectorAll<HTMLElement>('[data-testid="daemon-row"]'),
        ]
        await expect(rows.length).toBeGreaterThan(0)
        for (const row of rows) {
            const actions = row.lastElementChild as HTMLElement
            await expect(actions.textContent).toMatch(/off|on/)
            await expect(getComputedStyle(actions).position).toBe('absolute')
            const status = row.children[2] as HTMLElement
            const gap = row.getBoundingClientRect().right - status.getBoundingClientRect().right
            await expect(gap).toBeGreaterThanOrEqual(6)
            await expect(gap).toBeLessThanOrEqual(12)
        }
        // `[ off ]` on an enabled row disables it without opening the definition.
        const enabled = rows.find(r => r.children[2].textContent === 'on')!
        const name = enabled.querySelector('[class*="name"]')!.textContent!
        baseProps.onOpen.mockClear()
        await userEvent.click(within(enabled).getByRole('button', { name: /off/ }))
        await expect(baseProps.onToggle).toHaveBeenCalledWith(name, false)
        await expect(baseProps.onOpen).not.toHaveBeenCalled()
        // Scripted focus counts as keyboard focus (:focus-visible), which keeps a row's actions
        // up; release it so the story rests the way a person sees the list.
        ;(document.activeElement as HTMLElement | null)?.blur()
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
        // 'on' is both an enabled row's status and a disabled row's `[ on ]` button.
        await expect(canvas.getAllByText('on').length).toBeGreaterThan(0)
        const row = name.closest<HTMLElement>('[data-testid="daemon-row"]')!
        const status = row.lastElementChild as HTMLElement
        const rowRect = row.getBoundingClientRect()
        const statusRect = status.getBoundingClientRect()
        await expect(statusRect.right).toBeLessThanOrEqual(rowRect.right + 1)
        await expect(statusRect.left).toBeGreaterThanOrEqual(rowRect.left)
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

/** A row-limited list — 6 services, `limit={2}` shows 2 rows plus `+4 more`. The count
 *  badge always reads the full total, never the limited count. */
export const Limited: Story = {
    render: () => {
        const processes = Array.from({ length: 6 }, (_, i) => ({
            name: `service-${i}`,
            file: `service-${i}`,
            enabled: true,
            running: false,
        }))
        return (
            <div style={{ width: '360px', height: '160px' }}>
                <DaemonProcesses
                    {...baseProps}
                    processes={processes}
                    limit={2}
                    {...{ onOpenSection }}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const rows = () =>
            canvasElement.querySelectorAll('[data-testid="daemon-row"]')
        await expect(rows().length).toBe(2)
        const badge = within(
            canvasElement.querySelector(
                '[data-testid="daemon-section-services"]',
            ) as HTMLElement,
        ).getByText('6')
        await expect(badge).toBeInTheDocument()
        const more = canvas.getByRole('button', { name: /\+4 more/ })
        await expect(more).toBeInTheDocument()
        // The opener hands off to the host (full-screen section) — it no longer expands in place.
        await userEvent.click(more)
        await expect(onOpenSection).toHaveBeenCalled()
        await expect(rows().length).toBe(2)
    },
}

/** The opened section's list — every row (12 services), no box of its own, at takeover width. */
export const Full: Story = {
    render: () => {
        const processes = Array.from({ length: 12 }, (_, i) => ({
            name: `service-${i}`,
            file: `service-${i}`,
            enabled: i !== 3,
            running: false,
        }))
        return (
            <div style={{ width: '100%', 'max-width': '1300px' }}>
                <DaemonProcesses {...baseProps} variant="full" processes={processes} />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const list = canvasElement.querySelector('[data-testid="daemon-processes-full"]')!
        await expect(list.getAttribute('data-variant')).toBe('full')
        await expect(list.querySelectorAll('[data-testid="daemon-row"]').length).toBe(12)
        await expect(
            canvasElement.querySelector('[data-testid="daemon-section-services"]'),
        ).toBeNull()
    },
}

/** Nothing configured and the section opened anyway: the opened body says so instead of a
 *  blank takeover. */
export const FullEmpty: Story = {
    render: () => (
        <div style={{ width: '100%', 'max-width': '1300px' }}>
            <DaemonProcesses {...baseProps} variant="full" processes={[]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('no services yet // ask the daemon'),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-processes-full"]'),
        ).toBeNull()
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
            canvas.getByText('no services yet // ask the daemon'),
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
        // 'on' is both an enabled row's status and a disabled row's `[ on ]` button.
        await expect(canvas.getAllByText('on').length).toBeGreaterThan(0)
        const dots = [
            ...canvasElement.querySelectorAll<HTMLElement>('[class*="dot-wrap"]'),
        ]
        await expect(dots.length).toBeGreaterThan(0)
        for (const dot of dots) {
            await expect(getComputedStyle(dot).boxShadow).toBe('none')
        }
    },
}
