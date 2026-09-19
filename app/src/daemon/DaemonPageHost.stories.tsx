// app/src/daemon/DaemonPageHost.stories.tsx
// Visual spec for <DaemonPageHost> — the daemon page's real container: polls GET /daemon/snapshot
// + GET /daemon/logs against the global fakeTransport (app/.storybook/preview.ts), reads the
// shared inbox store, and derives the face's mood/caption before handing everything to the
// presentational <DaemonPage> (whose own layout stories live in DaemonPage.stories.tsx — that
// file's own `Host` story already renders this same container against the fake transport for its
// layout assertions; these stories instead prove HOST's OWN job: the poll actually lands data,
// and `daemon.enabled: false` skips it — never wiring or fetch, not layout).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { getOwner, onCleanup, type JSX } from 'solid-js'
import { expect, waitFor, within } from 'storybook/test'
import DaemonPageHost from './DaemonPageHost'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from '../daemonInbox'

const meta = {
    title: 'Daemon/DaemonPageHost',
    component: DaemonPageHost,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonPageHost>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []
const noop = () => {}

function Frame(props: { children: JSX.Element }) {
    return (
        <div style={{ width: '100%', height: '100vh', 'max-width': '100%' }}>
            {props.children}
        </div>
    )
}

/** Whether the story's render ran under a reactive owner — `onCleanup` (which restores
 *  `settings.daemon.enabled` afterwards) is a silent no-op unowned, so play() fails loudly
 *  instead of leaking the write into every later story (same trap DaemonPage.stories.tsx's own
 *  `Host` story documents). */
let owned = false

/** `daemon.enabled: true` — the container's poll effect fires on mount, lands the fake
 *  `/daemon/snapshot` + `/daemon/logs` data, and hands it down: the crons panel showing
 *  `morning-brief` proves /daemon/snapshot's data reached DaemonPage THROUGH this container,
 *  not just that DaemonPage itself can render it. */
export const Awake: Story = {
    render: () => {
        owned = getOwner() !== null
        const previous = settings.daemon.enabled
        setSettings('daemon', 'enabled', true)
        onCleanup(() => setSettings('daemon', 'enabled', previous))
        void refreshDaemonPages()
        return (
            <Frame>
                <DaemonPageHost
                    onOpen={noop}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await expect(owned).toBe(true)
        const canvas = within(canvasElement)
        const cronsPanel = () =>
            canvas.getByText('crons').parentElement!
                .parentElement as HTMLElement
        await waitFor(
            () =>
                expect(
                    within(cronsPanel()).getByText('morning-brief'),
                ).toBeInTheDocument(),
            { timeout: 5000 },
        )
        await expect(
            canvasElement.querySelector('[data-testid="daemon-face"]'),
        ).not.toBeNull()
        await expect(
            canvasElement.querySelector(
                '[data-testid="daemon-chat-composer"]',
            ),
        ).not.toBeNull()
    },
}

/** `daemon.enabled: false` — the poll effect never fires at all (it's gated on `enabled()`
 *  before touching the network), and the page renders its asleep/off face with no chat and no
 *  panels — proving the container withholds the fetch, not just that DaemonPage can render an
 *  empty snapshot. */
export const Off: Story = {
    render: () => {
        const previous = settings.daemon.enabled
        setSettings('daemon', 'enabled', false)
        onCleanup(() => setSettings('daemon', 'enabled', previous))
        return (
            <Frame>
                <DaemonPageHost
                    onOpen={noop}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvasElement.querySelector(
                '[data-testid="daemon-chat-composer"]',
            ),
        ).toBeNull()
        const caption = canvasElement.querySelector(
            '[data-testid="daemon-face-caption"]',
        )
        await expect(caption?.textContent).toBe('daemon')
        // The crons/services panels never mount at all while off (DaemonPage's own `enabled`
        // branch), which is also proof no snapshot fetch ever landed data to render them from.
        await expect(canvas.queryByText('crons')).toBeNull()
    },
}
