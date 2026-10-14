// Visual spec for <UpdateBanner> — the slim top bar shown when the source-built app is
// behind origin/main. UpdateBanner takes no data props; it reads a MODULE-LEVEL signal
// (updateCheck.ts's `updateStatus`) that only fills in from a real GET /update/status —
// updateCheck.ts calls `startUpdateChecks()` unconditionally at import time, which checks
// once immediately and then polls, but the shared fakeTransport has no /update/status route
// (an unhandled GET throws, caught silently — the banner just never appears).
//
// This file layers the update routes on top of the shared fakeTransport (scoped to these
// stories only) and calls updateCheck.ts's own exported `recheckUpdate()` — the same
// "call the imperative populate function inside the story's render" pattern Toast.tsx's
// pushToast() uses — so the banner reflects the seeded status immediately instead of waiting
// on the module's own retry interval.
//
// The banner is a ViewBar so it shares the toolbars' edges; `AboveAToolbar` is the story that
// proves it, stacking the banner over a real view header the way EditorPane stacks it over a
// pane's bar. A banner rendered alone cannot show alignment.
//
// The run stories (Updating, Cancelling, Cancelled, StartedElsewhere) render the ToastHost beside
// the banner: the run is shared (updateRun.ts), so the progress toast and the banner must agree on
// the phase and both offer the same cancel.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import type { JSX } from 'solid-js'
import { UpdateBanner } from './UpdateBanner'
import { recheckUpdate } from './updateCheck'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'
import type { Transport } from './api'
import type { UpdateStatus } from '../../core/src/selfUpdate'
import ViewBar, { Crumb } from './ui/ViewBar'
import { IconButton } from './ui/IconButton'
import { SegmentedToggle } from './ui/SegmentedToggle'
import Text from './ui/Text'
import { ToastHost } from './ui/ToastHost'

function status(behind: number): UpdateStatus {
    return {
        available: true,
        behind,
        localSha: 'abc1234',
        remoteSha: 'def5678',
        builtSha: 'abc1234',
        dirty: false,
    }
}

type Backend = {
    /** The phase the backend is already in when the story opens (a run some other caller began). */
    phase?: 'idle' | 'building'
    /** How a cancel answers: at once with `cancelled`, or never (the run is still winding down). */
    cancel?: 'stops' | 'hangs'
}

/** The shared fake plus the four update routes, as a tiny backend: apply starts a build that
 *  never finishes on its own, so the working state holds still for as long as the story is open. */
function updateTransport(s: UpdateStatus, b: Backend = {}): Transport {
    const base = fakeTransport()
    let phase: string = b.phase ?? 'idle'
    let cancelling = false
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/update/status') return s as unknown as T
            if (path === '/update/progress') {
                if (phase === 'pulling') phase = 'building'
                return (
                    cancelling ? { phase, cancelling } : { phase }
                ) as unknown as T
            }
            return base.getJson<T>(path)
        },
        postJson: async <T,>(path: string, body: unknown): Promise<T> => {
            if (path === '/update/apply') {
                phase = 'pulling'
                return { phase } as unknown as T
            }
            if (path === '/update/cancel') {
                if (b.cancel === 'hangs') {
                    cancelling = true
                    return new Promise<T>(() => {})
                }
                phase = 'cancelled'
                return { phase, message: 'update cancelled' } as unknown as T
            }
            return base.postJson<T>(path, body)
        },
    }
}

function seed(behind: number, b?: Backend) {
    setTransport(updateTransport(status(behind), b))
    recheckUpdate()
}

/** A column the width of an editor pane, with a body under it, like EditorPane's. */
function Column(props: { children: JSX.Element; w?: string }) {
    return (
        <div
            style={{
                width: props.w ?? '720px',
                border: '1px solid var(--border)',
                background: 'var(--bg)',
            }}
        >
            {props.children}
            <Text
                as="div"
                size="body"
                tone="muted"
                style={{
                    height: '120px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                }}
            >
                (view content)
            </Text>
        </div>
    )
}

const meta = {
    title: 'App/UpdateBanner',
    component: UpdateBanner,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof UpdateBanner>

export default meta
type Story = StoryObj<typeof meta>

/** Several commits behind — the common case. */
export const Default: Story = {
    render: () => {
        seed(5)
        return (
            <Column>
                <UpdateBanner />
            </Column>
        )
    },
}

/** Exactly one commit behind — the singular "commit" (vs "commits") pluralization branch. */
export const OneCommitBehind: Story = {
    render: () => {
        seed(1)
        return (
            <Column>
                <UpdateBanner />
            </Column>
        )
    },
}

/** THE ALIGNMENT STORY. The banner over a real view header (the graph's shape: a crumb, a mode
 *  switcher, two icon actions). Same height, the message starts where the crumb starts, the
 *  dismiss [x] ends where the toolbar's last icon ends, and the two hairlines are one rule. */
export const AboveAToolbar: Story = {
    render: () => {
        seed(5)
        return (
            <Column>
                <UpdateBanner />
                <ViewBar
                    identity={<Crumb icon="Network">Knowledge Graph</Crumb>}
                    facet={
                        <SegmentedToggle
                            value={0}
                            onChange={() => {}}
                            options={[
                                { id: 0, label: '2nd' },
                                { id: 1, label: '3rd' },
                                { id: 2, label: 'both' },
                            ]}
                        />
                    }
                    actions={
                        <>
                            <IconButton
                                icon="Settings"
                                label="Settings"
                                size="sm"
                            />
                            <IconButton icon="Code" label="Source" size="sm" />
                        </>
                    }
                />
            </Column>
        )
    },
}

/** A banner over its column, with the toast stack the shared run reports to. */
function RunColumn() {
    return (
        <>
            <Column>
                <UpdateBanner />
            </Column>
            <ToastHost />
        </>
    )
}

/** Mid-update: after `update` is pressed the phase readout appears, `cancel` replaces `update`
 *  and the dismiss [x], and the progress toast shows the same phase with its own `cancel`. The
 *  fake build never finishes. */
export const Updating: Story = {
    render: () => {
        seed(5)
        return <RunColumn />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole('button', { name: 'update' }))
        await waitFor(() =>
            expect(canvas.getAllByRole('button', { name: 'cancel' })).toHaveLength(2),
        )
        await waitFor(() => expect(canvas.getByText('Building… (a few min)')).toBeTruthy(), {
            timeout: 5000,
        })
        expect(canvas.getByText('Building update… (a few min)')).toBeTruthy()
        expect(canvas.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    },
}

/** Cancel pressed while the backend is still stopping the run: the banner reads `cancelling…`
 *  (disabled) and the toast reads `Cancelling update…` with no second cancel. */
export const Cancelling: Story = {
    render: () => {
        seed(5, { cancel: 'hangs' })
        return <RunColumn />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole('button', { name: 'update' }))
        const cancels = await canvas.findAllByRole('button', { name: 'cancel' })
        await userEvent.click(cancels[0])
        await waitFor(() =>
            expect(
                (canvas.getByRole('button', { name: 'cancelling…' }) as HTMLButtonElement)
                    .disabled,
            ).toBe(true),
        )
        expect(canvas.getByText('Cancelling update…')).toBeTruthy()
        expect(canvas.getByText('Cancelling…')).toBeTruthy()
        expect(canvas.queryByRole('button', { name: 'cancel' })).toBeNull()
    },
}

/** Cancel from the toast: the run stops, the banner is back to `update` + dismiss, and the toast
 *  says `Update cancelled`. */
export const Cancelled: Story = {
    render: () => {
        seed(5)
        return <RunColumn />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(await canvas.findByRole('button', { name: 'update' }))
        const cancels = await canvas.findAllByRole('button', { name: 'cancel' })
        await userEvent.click(cancels[cancels.length - 1])
        await waitFor(() => expect(canvas.getByText('Update cancelled')).toBeTruthy(), {
            timeout: 5000,
        })
        expect(canvas.getByRole('button', { name: 'update' })).toBeTruthy()
        expect(canvas.getByRole('button', { name: 'Dismiss' })).toBeTruthy()
    },
}

/** A run the window did not start (the CLI's `bismuth update apply`, or one that outlived a
 *  reload): the status check adopts it, so the banner and the toast show it with no click. */
export const StartedElsewhere: Story = {
    render: () => {
        seed(5, { phase: 'building' })
        return <RunColumn />
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await waitFor(() =>
            expect(canvas.getAllByRole('button', { name: 'cancel' })).toHaveLength(2),
        )
        expect(canvas.getByText('Building update… (a few min)')).toBeTruthy()
    },
}

/** A pane below ViewBar's floor tier (430px): the message runs under the bar's fade mask, the same
 *  way every toolbar's lead does at that width, and update + dismiss stay pinned right. */
export const Narrow: Story = {
    render: () => {
        seed(12)
        return (
            <Column w="300px">
                <UpdateBanner />
            </Column>
        )
    },
}
