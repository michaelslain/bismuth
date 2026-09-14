// Visual spec for <DaemonPage> — the daemon's own page, "face as hub": crons + services left, the
// living `.:[00]:.` centre, inbox over log right, the docked chat band along the bottom.
//
// DaemonPage is presentational, so the mood stories feed it fixtures + the real model derivations
// (faceCaption / barReadouts) and the band's real resting content: DaemonChatPlaceholder, the inert
// composer stand-in a page shows until a trusted user gesture arms the chat (in the app, App's chat
// overlay then covers the band with the real ChatView, which a story cannot mount). `Host` renders
// the real container against the global fakeTransport instead.
//
// Busy/talking faces tick every few hundred ms, so two shots of Working rarely match — that is the
// face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { getOwner, onCleanup, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import DaemonPage, { type DaemonPageProps } from './DaemonPage'
import DaemonPageHost from './DaemonPageHost'
import DaemonChatPlaceholder from './DaemonChatPlaceholder'
import { barReadouts, faceCaption } from './daemonPageModel'
import type { DaemonMood } from './daemonFaceModel'
import {
    sampleActivity,
    sampleDaemonPages,
    sampleDaemonSnapshot,
} from '../ui/_daemonFixtures'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from '../daemonInbox'
import { daemonChatArmed } from './daemonChatArm'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'

const meta = {
    title: 'Daemon/DaemonPage',
    component: DaemonPage,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DaemonPage>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => {}

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
        caption: faceCaption(snapshot, mood, Date.now(), over.enabled ?? true),
        readouts: barReadouts(snapshot, due),
        onOpen: noop,
        onChanged: noop,
        chat: <DaemonChatPlaceholder />,
        ...over,
    }
}

const rect = (el: Element) => el.getBoundingClientRect()
const canvas = (el: HTMLElement) => within(el)

/** The layout contract every enabled page must keep. */
async function assertLayout(
    canvasElement: HTMLElement,
    opts: { band: boolean },
) {
    const page = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-page"]',
    )
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
        await expect(
            Math.abs(rect(band!).bottom - p.bottom),
        ).toBeLessThanOrEqual(1)
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
                ? {
                      timestamp: new Date(
                          Date.now() - 3 * 3600_000,
                      ).toISOString(),
                      result: 'success',
                  }
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
        const band = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(rect(band).height / rect(page).height).toBeLessThanOrEqual(
            0.36,
        )
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeGreaterThan(80)
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
            crons: sampleDaemonSnapshot().crons.map(c => ({
                ...c,
                running: false,
            })),
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
                <DaemonPage
                    {...pageProps(snap, 'asleep', { enabled: false })}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { band: false })
        const canvas = within(canvasElement)
        // The caption says the daemon is off; the EmptyState heading tells the user what to do
        // about it — they must not repeat the same sentence.
        await expect(
            canvas.getByText(/asleep .* daemon is off/i),
        ).toBeInTheDocument()
        const heading = canvas.getByRole('heading', { level: 2 })
        await expect(heading.textContent?.toLowerCase()).not.toContain(
            'daemon is off',
        )
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
        const face = canvasElement.querySelector(
            '[data-testid="daemon-page-hub"]',
        )!
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
        const band = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(rect(band).height).toBeLessThanOrEqual(200)
        await expect(rect(band).height).toBeGreaterThanOrEqual(150)
        // Nothing clipped: the whole glyph row sits inside the hub, and each panel keeps room for
        // its head plus rows (well over the one-row sliver the 220px band floor used to leave).
        const hub = rect(
            canvasElement.querySelector('[data-testid="daemon-page-hub"]')!,
        )
        const face = rect(
            canvasElement.querySelector('[data-testid="daemon-face"]')!,
        )
        await expect(face.top).toBeGreaterThanOrEqual(hub.top - 1)
        await expect(face.bottom).toBeLessThanOrEqual(hub.bottom + 1)
        const log =
            canvas(canvasElement).getByText('log').parentElement!.parentElement!
        await expect(rect(log).height).toBeGreaterThan(90)
    },
}

/** Whether Host's render ran under a reactive owner — asserted in its play(). */
let hostOwned = false

/** The real container against the global fakeTransport: polls /daemon/snapshot + /daemon/logs,
 *  reads the shared inbox store, and renders the `data-chat-host` band holding the inert
 *  placeholder — no ChatView, no session, until a trusted user gesture arms it (and even then
 *  only App's overlay mounts the chat; there is no App in a story). */
export const Host: Story = {
    render: () => {
        // `onCleanup` only runs under a reactive owner; unowned it is a silent no-op and the
        // settings write below would leak into every later story (GraphView.stories
        // MiniModeSwitcher documents the same trap). play() fails loudly if that ever happens.
        hostOwned = getOwner() !== null
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
        await expect(hostOwned).toBe(true)
        const canvas = within(canvasElement)
        // Scoped to the crons panel: `morning-brief` is also in the activity log, which comes from
        // /daemon/logs — only the crons panel proves /daemon/snapshot landed.
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
        const host = canvasElement.querySelector<HTMLElement>(
            '[data-chat-host="::chat:daemon"]',
        )
        await expect(host).not.toBeNull()
        // Unarmed: the band holds the inert placeholder, and a script's synthetic press or focus
        // (isTrusted === false) cannot arm it.
        const placeholder = host!.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-placeholder"]',
        )
        await expect(placeholder).not.toBeNull()
        const box = placeholder!.querySelector<HTMLElement>('[role="button"]')!
        await fireEvent.pointerDown(box)
        await fireEvent.focusIn(box)
        await expect(daemonChatArmed()).toBe(false)
        await expect(
            host!.querySelector('[data-testid="daemon-chat-placeholder"]'),
        ).not.toBeNull()
        await assertLayout(canvasElement, { band: true })
    },
}
