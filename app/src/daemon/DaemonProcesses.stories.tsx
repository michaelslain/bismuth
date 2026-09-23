// Visual spec for <DaemonProcesses> — the presentational services panel. Same shape as
// DaemonCrons.stories.tsx minus running/failed (a service has no discrete run state) plus the
// same create/delete/empty/offline matrix.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'
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
    },
}

/** An enabled service while the daemon process itself is offline — the dot must fall back to
 *  idle/faint rather than glowing, even though the service is still configured "on". */
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
        await userEvent.click(
            canvas.getByRole('button', { name: 'new service' }),
        )
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
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: canvas.getByText('sync-worker'),
        })
        const menuDelete = await canvas.findByText('Delete')
        await userEvent.click(menuDelete)
        await expect(
            canvas.getByRole('button', { name: 'delete' }),
        ).toBeInTheDocument()
        await expect(
            canvas.getByRole('button', { name: 'cancel' }),
        ).toBeInTheDocument()
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
}
