// Visual spec for <DaemonServices> — crons + background services rendered as two <DaemonPanel>s.
// Right-click opens the shared <ContextMenu> (Run now / Enable / Disable) via `openContextMenu`,
// which always falls back to the HTML menu outside Tauri — no native-menu dependency to fake
// here. Row actions POST to /daemon/*/toggle|run, which the shared fakeTransport acks
// generically (a 200 "ok" Response), so the menu items work as real callbacks, not just visual
// props.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import DaemonServices from './DaemonServices'
import { sampleDaemonSnapshot } from '../ui/_daemonFixtures'

const meta = {
    title: 'Daemon/DaemonServices',
    component: DaemonServices,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DaemonServices>

export default meta
type Story = StoryObj<typeof meta>

const SNAPSHOT = sampleDaemonSnapshot()

/** A mix of crons and processes across every status: running (glowing dot), idle, last-run-
 *  failed, disabled (dimmed), and a file-change cron. */
export const Default: Story = {
    render: () => (
        <div style={{ width: '280px', height: '420px' }}>
            <DaemonServices
                crons={SNAPSHOT.crons}
                processes={SNAPSHOT.processes}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
}

/** No crons or processes configured — each panel's own empty message. */
export const Empty: Story = {
    render: () => (
        <div style={{ width: '280px', height: '260px' }}>
            <DaemonServices
                crons={[]}
                processes={[]}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('no crons')).toBeInTheDocument()
        await expect(
            canvas.getByText('no background services'),
        ).toBeInTheDocument()
    },
}

/** Crons configured but no background services — the common real vault. The services panel must
 *  speak for its own list only, not claim nothing at all is configured. */
export const NoServices: Story = {
    render: () => (
        <div style={{ width: '280px', height: '260px' }}>
            <DaemonServices
                crons={SNAPSHOT.crons}
                processes={[]}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('no background services'),
        ).toBeInTheDocument()
        await expect(canvas.queryByText('no crons')).toBeNull()
    },
}

/** A cron name long enough that it must ellipsize in the fixed-height row rather than wrap or
 *  push the status/frequency columns off the edge. */
export const LongName: Story = {
    render: () => (
        <div style={{ width: '220px', height: '160px' }}>
            <DaemonServices
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
                processes={[]}
                onOpen={() => {}}
                onChanged={() => {}}
            />
        </div>
    ),
}
