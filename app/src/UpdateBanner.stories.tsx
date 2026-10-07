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

/** The shared fake plus the three update routes. Apply starts a build that never finishes, so
 *  the working state holds still for as long as the story is open. */
function updateTransport(s: UpdateStatus): Transport {
    const base = fakeTransport()
    return {
        ...base,
        getJson: async <T,>(path: string): Promise<T> => {
            if (path === '/update/status') return s as unknown as T
            if (path === '/update/progress')
                return { phase: 'building' } as unknown as T
            return base.getJson<T>(path)
        },
        postJson: async <T,>(path: string, body: unknown): Promise<T> => {
            if (path === '/update/apply')
                return { phase: 'pulling' } as unknown as T
            return base.postJson<T>(path, body)
        },
    }
}

function seed(behind: number) {
    setTransport(updateTransport(status(behind)))
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

/** Mid-update: after `update` is pressed the phase readout appears on the right, the button
 *  reads `updating…`, and both controls are disabled. The fake build never finishes. */
export const Updating: Story = {
    render: () => {
        seed(5)
        return (
            <Column>
                <UpdateBanner />
            </Column>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        const button = await canvas.findByRole('button', { name: /update/ })
        await userEvent.click(button)
        await waitFor(() => expect(canvas.getByText(/updating…/)).toBeTruthy())
        await waitFor(() =>
            expect(canvas.getByText(/Pulling…|Building…/)).toBeTruthy(),
        )
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
