// Visual spec for <DaemonPage> — the daemon's own page, "face as hub": crons + services left, the
// living `.:[00]:.` centre, inbox over log right, the docked chat band along the bottom.
//
// DaemonPage is presentational, so the mood stories feed it fixtures + the real model derivations
// (faceCaption / barReadouts) and a STUB chat band — in the app, that band is a `data-chat-host`
// placeholder App's chat overlay covers with the real ChatView, which a story cannot mount. The
// stub is drawn to read as the composer it stands in for, so the shot shows the page's real
// balance rather than an empty strip. `Host` renders the real container against the global
// fakeTransport instead.
//
// Busy/talking faces tick every few hundred ms, so two shots of Working rarely match — that is the
// face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { onCleanup, type JSX } from 'solid-js'
import { expect, waitFor, within } from 'storybook/test'
import DaemonPage, { type DaemonPageProps } from './DaemonPage'
import DaemonPageHost from './DaemonPageHost'
import { barReadouts, faceCaption } from './daemonPageModel'
import type { DaemonMood } from './daemonFaceModel'
import {
    sampleActivity,
    sampleDaemonPages,
    sampleDaemonSnapshot,
} from '../ui/_daemonFixtures'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from '../daemonInbox'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'

const meta = {
    title: 'Daemon/DaemonPage',
    component: DaemonPage,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonPage>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

/** Stand-in for the docked ChatView: a quiet transcript line over a hairline composer. */
function StubChat() {
    return (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                'justify-content': 'flex-end',
                gap: '12px',
                height: '100%',
                padding: '16px 24px',
                'box-sizing': 'border-box',
                'font-family': 'var(--ui-font-stack)',
                'font-size': 'var(--fs-ui)',
            }}
        >
            <div style={{ color: 'var(--text-muted)' }}>
                daemon // nothing needs you right now. the inbox is clear.
            </div>
            <div
                style={{
                    display: 'flex',
                    'align-items': 'center',
                    gap: '8px',
                    height: '30px',
                    padding: '0 10px',
                    border: '1px solid var(--border)',
                    'border-radius': '3px',
                    color: 'var(--faint)',
                }}
            >
                <span style={{ color: 'var(--accent)' }}>&gt;</span>
                ask the daemon…
            </div>
        </div>
    )
}

function Frame(props: {
    width?: string
    height?: string
    children: JSX.Element
}) {
    return (
        <div
            style={{
                width: props.width ?? '100%',
                height: props.height ?? '100vh',
                'max-width': '100%',
            }}
        >
            {props.children}
        </div>
    )
}

function pageProps(
    snapshot: DaemonSnapshot,
    mood: DaemonMood,
    over: Partial<DaemonPageProps> = {},
): DaemonPageProps {
    const pages = over.pages ?? []
    const due = pages.filter(p => p.status === 'pending').length
    return {
        name: 'daemon',
        enabled: true,
        snapshot,
        pages,
        events: sampleActivity(),
        mood,
        caption: faceCaption(snapshot, mood, Date.now()),
        readouts: barReadouts(snapshot, due),
        onOpen: noop,
        onChanged: noop,
        chat: <StubChat />,
        ...over,
    }
}

const rect = (el: Element) => el.getBoundingClientRect()
const canvas = (el: HTMLElement) => within(el)

/** The layout contract every enabled page must keep. */
async function assertLayout(canvasElement: HTMLElement, opts: { band: boolean }) {
    const page = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-page"]')
    await expect(page).not.toBeNull()
    const face = page!.querySelector('[data-testid="daemon-face"]')
    const hub = page!.querySelector('[data-testid="daemon-page-hub"]')
    await expect(face).not.toBeNull()
    await expect(hub).not.toBeNull()
    const f = rect(face!)
    const h = rect(hub!)
    await expect(f.width).toBeGreaterThan(0)
    await expect(
        Math.abs(f.left + f.width / 2 - (h.left + h.width / 2)),
    ).toBeLessThanOrEqual(8)

    const p = rect(page!)
    const band = page!.querySelector('[data-testid="daemon-page-chat"]')
    if (opts.band) {
        await expect(band).not.toBeNull()
        await expect(Math.abs(rect(band!).bottom - p.bottom)).toBeLessThanOrEqual(1)
    } else {
        await expect(band).toBeNull()
    }

    const overflowing = [...page!.querySelectorAll<HTMLElement>('*')]
        .filter(el => {
            const r = rect(el)
            if (r.width === 0 && r.height === 0) return false
            return r.left < p.left - 1 || r.right > p.right + 1
        })
        .map(el => `${el.tagName.toLowerCase()}.${el.className}`)
    await expect(overflowing).toEqual([])
}

const IDLE_SNAPSHOT = sampleDaemonSnapshot({
    crons: sampleDaemonSnapshot().crons.map(c => ({
        ...c,
        running: false,
        startedAt: null,
        lastFired:
            c.lastFired?.result === 'failed'
                ? { timestamp: new Date(Date.now() - 3 * 3600_000).toISOString(), result: 'success' }
                : c.lastFired,
    })),
})

/** The resting page: watching, breathing, blinking. Nothing running, nothing due. */
export const Awake: Story = {
    render: () => (
        <Frame>
            <DaemonPage {...pageProps(IDLE_SNAPSHOT, 'idle')} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { band: true })
        // The face is the centrepiece: the band keeps about a third of the page, never half, and
        // the glyphs render well above their 56px floor in a full-width pane.
        const page = canvasElement.querySelector('[data-testid="daemon-page"]')!
        const band = canvasElement.querySelector('[data-testid="daemon-page-chat"]')!
        await expect(rect(band).height / rect(page).height).toBeLessThanOrEqual(0.36)
        const face = canvasElement.querySelector<HTMLElement>('[data-testid="daemon-face"]')!
        await expect(parseFloat(getComputedStyle(face).fontSize)).toBeGreaterThan(80)
    },
}

/** A cron is running: the eyes scan `=-` `==` `-=` and the caption names the job. */
export const Working: Story = {
    render: () => (
        <Frame>
            <DaemonPage {...pageProps(sampleDaemonSnapshot(), 'busy')} />
        </Frame>
    ),
    play: ({ canvasElement }) => assertLayout(canvasElement, { band: true }),
}

/** Inbox pages are due: eyes wide `OO`, the bar reads `N in inbox`. */
export const NeedsYou: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps(IDLE_SNAPSHOT, 'alert', {
                    pages: sampleDaemonPages(),
                })}
            />
        </Frame>
    ),
    play: ({ canvasElement }) => assertLayout(canvasElement, { band: true }),
}

/** A cron failed in the last half hour: `.:[><]:.` in the danger tone, still. */
export const Hurt: Story = {
    render: () => {
        const snap = sampleDaemonSnapshot({
            crons: sampleDaemonSnapshot().crons.map(c => ({ ...c, running: false })),
        })
        return (
            <Frame>
                <DaemonPage {...pageProps(snap, 'hurt')} />
            </Frame>
        )
    },
    play: ({ canvasElement }) => assertLayout(canvasElement, { band: true }),
}

/** `daemon.enabled: false` — the face sleeps alone with how to wake it. No panels, no chat band. */
export const Off: Story = {
    render: () => {
        const snap = sampleDaemonSnapshot({
            daemon: { label: 'daemon', running: false, home: '/vault/.daemon' },
        })
        return (
            <Frame>
                <DaemonPage {...pageProps(snap, 'asleep', { enabled: false })} />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { band: false })
        const canvas = within(canvasElement)
        await expect(canvas.getByText(/the daemon is off/i)).toBeInTheDocument()
        await expect(canvasElement.querySelector('[data-chat-host]')).toBeNull()
    },
}

/** A 640px pane: the columns stack (face, services, inbox + log) in a scrolling stage while the
 *  chat band stays pinned along the bottom. */
export const Narrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage
                {...pageProps(sampleDaemonSnapshot(), 'busy', {
                    pages: sampleDaemonPages(),
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { band: true })
        // Stacked face-first: the face sits above the crons panel, which sits above the inbox.
        const face = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const crons = canvas(canvasElement).getByText('crons')
        const inbox = canvas(canvasElement).getByText('inbox')
        await expect(rect(face).top).toBeLessThan(rect(crons).top)
        await expect(rect(crons).top).toBeLessThan(rect(inbox).top)
    },
}

/** A split-down pane only 332px tall: the band gives back its floor and the stage scrolls a
 *  usable row, so the panels and the face stay whole instead of being crushed to slivers. */
export const ShortPane: Story = {
    render: () => (
        <Frame height="332px">
            <DaemonPage
                {...pageProps(sampleDaemonSnapshot(), 'busy', {
                    pages: sampleDaemonPages(),
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { band: true })
        const band = canvasElement.querySelector('[data-testid="daemon-page-chat"]')!
        await expect(rect(band).height).toBeLessThanOrEqual(200)
        await expect(rect(band).height).toBeGreaterThanOrEqual(150)
        // Nothing clipped: the whole glyph row sits inside the hub, and each panel keeps room for
        // its head plus rows (well over the one-row sliver the 220px band floor used to leave).
        const hub = rect(canvasElement.querySelector('[data-testid="daemon-page-hub"]')!)
        const face = rect(canvasElement.querySelector('[data-testid="daemon-face"]')!)
        await expect(face.top).toBeGreaterThanOrEqual(hub.top - 1)
        await expect(face.bottom).toBeLessThanOrEqual(hub.bottom + 1)
        const log = canvas(canvasElement).getByText('log').parentElement!.parentElement!
        await expect(rect(log).height).toBeGreaterThan(90)
    },
}

/** The real container against the global fakeTransport: polls /daemon/snapshot + /daemon/logs,
 *  reads the shared inbox store, and renders the `data-chat-host` placeholder App's overlay
 *  covers (empty here — there is no App in a story). */
export const Host: Story = {
    render: () => {
        const previous = settings.daemon.enabled
        setSettings('daemon', 'enabled', true)
        onCleanup(() => setSettings('daemon', 'enabled', previous))
        void refreshDaemonPages()
        return (
            <Frame>
                <DaemonPageHost onOpen={noop} />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        // Once in the crons panel, again in the log — any match proves the snapshot landed.
        await waitFor(
            () => expect(canvas.getAllByText('morning-brief').length).toBeGreaterThan(0),
            { timeout: 5000 },
        )
        await expect(
            canvasElement.querySelector('[data-chat-host="::chat:daemon"]'),
        ).not.toBeNull()
        await assertLayout(canvasElement, { band: true })
    },
}
