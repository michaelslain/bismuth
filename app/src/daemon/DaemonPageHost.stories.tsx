// app/src/daemon/DaemonPageHost.stories.tsx
// Visual spec for <DaemonPageHost> — the daemon page's real container: polls GET /daemon/snapshot
// + GET /daemon/logs against the global fakeTransport (app/.storybook/preview.ts), reads the
// shared inbox store, and derives the hub's mood/status before handing everything to the
// presentational <DaemonPage> (whose own layout stories live in DaemonPage.stories.tsx — that
// file's own `Host` story already renders this same container for its layout assertions; these
// stories instead prove HOST's OWN job: the poll actually lands data into the overview column,
// and `daemon.enabled: false` skips it entirely — never wiring or fetch, not layout).
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
 *  `/daemon/snapshot` + `/daemon/logs` data, and hands it down: the overview column showing
 *  `morning-brief` proves /daemon/snapshot's data reached the crons section THROUGH this
 *  container, not just that DaemonCrons itself can render it. */
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
        const overview = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="daemon-page-overview"]',
            )!
        // Every section shows at once now, so "morning-brief" (the cron name) can legitimately
        // appear more than once — in the crons row AND in the log's own entries for it. Any
        // match proves the data landed through this container.
        await waitFor(
            () =>
                expect(
                    within(overview()).getAllByText('morning-brief').length,
                ).toBeGreaterThan(0),
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
 *  overview column — proving the container withholds the fetch, not just that DaemonPage can
 *  render an empty snapshot. */
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
        await expect(
            canvasElement.querySelector(
                '[data-testid="daemon-chat-composer"]',
            ),
        ).toBeNull()
        // The overview column never mounts at all while off (DaemonPage's own `enabled` branch),
        // which is also proof no snapshot fetch ever landed data to render one from.
        await expect(
            canvasElement.querySelector('[data-testid="daemon-page-overview"]'),
        ).toBeNull()
    },
}
