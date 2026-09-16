// Visual spec for <DaemonPage> — the daemon's own page, "face as hub": crons + services left, the
// living `.:[00]:.` + its own chat centre, inbox over log right. No band across the bottom — the
// chat lives ONLY in the centre column, under the face.
//
// DaemonPage is presentational, so the mood stories feed it fixtures + the real model derivations
// (faceCaption / barReadouts) and a local `ChatStub` standing in for the centre column's chat: the
// REAL `chat/ChatComposerBar.tsx` + `chat/ChatControls.tsx` driven by a stub session
// (`chat/_stubChatSession.ts`), so a layout story shows the shipped composer/controls look — never
// a hand-drawn mono placeholder — plus a plain transcript-shaped block when `conversing` (the
// transcript's own look is Group 2/3's concern, not this layout story's). `Host` renders the real
// container against the global fakeTransport instead —
// it passes the real (always false here, since no App exists in a story to retain a session)
// `conversing`, computed from `chatSession(DAEMON_CHAT_ID)`'s transcript.
//
// Busy/talking faces tick every few hundred ms, so two shots of Working rarely match — that is the
// face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { getOwner, onCleanup, Show, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
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
import { daemonChatArmed } from './daemonChatArm'
import type { DaemonSnapshot } from '../../../core/src/daemonGraph'
import Text from '../ui/Text'
import ChatComposerBar from '../chat/ChatComposerBar'
import ChatControls from '../chat/ChatControls'
import { makeStubChatSession } from '../chat/_stubChatSession'
import pageStyles from './DaemonPage.module.css'

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

const noStoryNames = () => []

/** The centre column's `chat` slot for every story: the REAL `ChatComposerBar` with the REAL
 *  `ChatControls` as its `below` — exactly what `daemon/DaemonChat.tsx` renders — driven by a
 *  freshly-built stub session (`chat/_stubChatSession.ts`) so the composer box, placeholder and
 *  controls row read as the shipped daemon-chat look, not a hand-drawn mono mockup. With `tall`,
 *  also a plain transcript-shaped block above it that fills the rest of the column — standing in
 *  for `ChatTranscript`, whose own look belongs to `chat/ChatTranscript.stories.tsx`, not here. */
function ChatStub(props: { tall?: boolean }) {
    const session = makeStubChatSession()
    return (
        <div
            data-testid="chat-stub"
            style={{
                display: 'flex',
                'flex-direction': 'column',
                height: '100%',
                'min-height': '0',
                gap: 'var(--sp-3)',
            }}
        >
            <Show when={props.tall}>
                <div
                    style={{
                        flex: '1',
                        'min-height': '0',
                        border: 'var(--rule)',
                        'border-radius': 'var(--r-0)',
                        padding: 'var(--sp-4)',
                        overflow: 'hidden',
                    }}
                >
                    <Text size="ui" tone="muted">
                        you // what's due today?
                    </Text>
                    <Text size="ui">
                        two pages need you, nothing else is late.
                    </Text>
                </div>
            </Show>
            <ChatComposerBar
                session={session}
                placeholder="Message daemon…"
                noteNames={noStoryNames}
                memoryNames={noStoryNames}
                tagNames={noStoryNames}
                below={<ChatControls session={session} />}
            />
        </div>
    )
}

/** A stub standing in for `chat/ChatHistoryPanel.tsx` when it has taken over the centre column's
 *  chat region (Task 4's takeover) — a full-height list, never a sliver, which is exactly what
 *  `chatFills` exists to prove: without it this pane would render in the content-height box the
 *  resting composer gets instead of the column's full remaining height. */
function HistoryStub() {
    return (
        <div
            data-testid="chat-history-stub"
            style={{
                display: 'flex',
                'flex-direction': 'column',
                height: '100%',
                'min-height': '0',
                border: 'var(--rule)',
                'border-radius': 'var(--r-0)',
                padding: 'var(--sp-4)',
                overflow: 'hidden',
                gap: 'var(--sp-3)',
            }}
        >
            <Text size="ui" tone="muted">
                history
            </Text>
            <Text size="ui">morning brief — 2h ago</Text>
            <Text size="ui">inbox review — yesterday</Text>
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
    const status = faceCaption(snapshot, mood, Date.now(), over.enabled ?? true)
    return {
        name: 'daemon',
        enabled: true,
        snapshot,
        pages,
        events: sampleActivity(),
        mood,
        caption: 'daemon',
        readouts: barReadouts(snapshot, due, status),
        onOpen: noop,
        onChanged: noop,
        chat: <ChatStub />,
        conversing: false,
        chatFills: false,
        ...over,
    }
}

const rect = (el: Element) => el.getBoundingClientRect()
const canvas = (el: HTMLElement) => within(el)
const classEl = (root: HTMLElement, cls: string) =>
    root.getElementsByClassName(cls)[0] as HTMLElement | undefined

/** The layout contract every enabled page must keep: the face centred in the centre column, the
 *  chat (when present) never wider than that column, and — for the wide grid — the left/right
 *  columns' bottoms landing at the stage's own inset, the same as its top. `stacked: true` (the
 *  narrow story) skips that last check: the columns are no longer in the same grid row. */
async function assertLayout(
    canvasElement: HTMLElement,
    opts: { chat: boolean; stacked?: boolean },
) {
    const page = canvasElement.querySelector<HTMLElement>(
        '[data-testid="daemon-page"]',
    )
    await expect(page).not.toBeNull()
    const stage = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-stage"]',
    )
    await expect(stage).not.toBeNull()
    const hub = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-hub"]',
    )
    const face = page!.querySelector('[data-testid="daemon-face"]')
    await expect(face).not.toBeNull()
    await expect(hub).not.toBeNull()
    const f = rect(face!)
    const h = rect(hub!)
    await expect(f.width).toBeGreaterThan(0)
    await expect(
        Math.abs(f.left + f.width / 2 - (h.left + h.width / 2)),
    ).toBeLessThanOrEqual(8)

    const p = rect(page!)

    if (!opts.stacked) {
        const s = rect(stage!)
        const padBottom = parseFloat(getComputedStyle(stage!).paddingBottom)
        const expectedBottom = s.bottom - padBottom
        const left = classEl(page!, pageStyles.left)
        const right = classEl(page!, pageStyles.right)
        if (page!.dataset.enabled === 'true') {
            // The headline claim of this layout: both side columns exist and land flush with the
            // stage's own bottom inset. Assert they exist FIRST — an `if (left)` guard here would
            // let a missing column pass silently instead of failing the story.
            await expect(left).not.toBeUndefined()
            await expect(right).not.toBeUndefined()
            await expect(
                Math.abs(rect(left!).bottom - expectedBottom),
            ).toBeLessThanOrEqual(2)
            await expect(
                Math.abs(rect(right!).bottom - expectedBottom),
            ).toBeLessThanOrEqual(2)
        } else {
            await expect(left).toBeUndefined()
            await expect(right).toBeUndefined()
        }
    }

    const chat = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-chat"]',
    )
    if (opts.chat) {
        await expect(chat).not.toBeNull()
        const c = rect(chat!)
        // The composer's edges sit INSIDE the centre column, never wider — and never a full-width
        // band across the page.
        await expect(c.left).toBeGreaterThanOrEqual(h.left - 1)
        await expect(c.right).toBeLessThanOrEqual(h.right + 1)
        await expect(c.width).toBeLessThan(p.width)
    } else {
        await expect(chat).toBeNull()
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

/** The resting page: watching, blinking. Nothing running, nothing due. The face is centred in the
 *  space ABOVE the composer, which sits at exactly its own content height. */
export const Awake: Story = {
    render: () => (
        <Frame>
            <DaemonPage {...pageProps(IDLE_SNAPSHOT, 'idle')} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        // Resting: the chat region is content-height (composer + controls row), a small fraction
        // of the centre column, and the face reads well above its 56px floor in a full-width pane.
        const hub = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeLessThanOrEqual(0.4)
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
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
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
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
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
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
}

/** Messages exist: the face goes compact and rides the top of the centre column, the chat region
 *  fills the rest and holds the transcript, and the face reads smaller than the resting stories. */
export const Conversing: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps(sampleDaemonSnapshot(), 'talking', {
                    chat: <ChatStub tall />,
                    conversing: true,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const hub = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        // The chat now fills most of the column instead of a small fraction of it.
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeGreaterThanOrEqual(0.55)
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThan(56)
    },
}

/** `daemon.enabled: false` — the face sleeps alone with how to wake it. No panels, no chat at all. */
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
        await assertLayout(canvasElement, { chat: false })
        const canvas = within(canvasElement)
        // The caption is the daemon's NAME now (its status moved to the bar's first readout, which
        // is hidden while off along with the rest of the bar's counts) — the EmptyState heading is
        // the only place "daemon is off" appears, so it must not be duplicated under the face. The
        // caption sits as the face's next sibling (DaemonFace.tsx); "daemon" also names the crumb,
        // so a plain getByText would be ambiguous.
        const face = canvasElement.querySelector('[data-testid="daemon-face"]')!
        await expect(face.nextElementSibling?.textContent).toBe('daemon')
        const heading = canvas.getByRole('heading', { level: 2 })
        await expect(heading.textContent?.toLowerCase()).not.toContain(
            'daemon is off',
        )
        await expect(
            canvasElement.querySelector('[data-testid="daemon-chat-composer"]'),
        ).toBeNull()
    },
}

/** A 640px pane, resting (not conversing): the columns stack (face, chat, services, inbox + log)
 *  in a scrolling stage, and the chat region stays content-height — just the composer + controls
 *  row, no dead space above it, same as the wide resting layout. */
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
        await assertLayout(canvasElement, { chat: true, stacked: true })
        // Stacked face-then-chat-first: the face and its chat sit above the crons panel, which
        // sits above the inbox.
        const face = canvasElement.querySelector(
            '[data-testid="daemon-page-hub"]',
        )!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        const crons = canvas(canvasElement).getByText('crons')
        const inbox = canvas(canvasElement).getByText('inbox')
        await expect(rect(face).top).toBeLessThan(rect(crons).top)
        await expect(rect(chat).bottom).toBeLessThanOrEqual(
            rect(crons).top + 1,
        )
        await expect(rect(crons).top).toBeLessThan(rect(inbox).top)
        // Resting: content-height, not the ~420px conversing box — the gap to the crons panel
        // below it is just the stage's own stacking `gap`, the same one that separates every other
        // pair of stacked blocks here, nowhere near what a stray fixed-height chat region would leave.
        await expect(rect(chat).height).toBeLessThan(120)
        await expect(rect(chat).height).toBeGreaterThan(0)
        await expect(rect(crons).top - rect(chat).bottom).toBeLessThan(80)
    },
}

/** Narrow AND conversing: the chat holds its fixed ~420px box (never flexing to fill, since the
 *  stage itself scrolls here), with the compact face above it. */
export const ConversingNarrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage
                {...pageProps(sampleDaemonSnapshot(), 'talking', {
                    chat: <ChatStub tall />,
                    conversing: true,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, stacked: true })
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(rect(chat).height).toBeLessThanOrEqual(430)
        await expect(rect(chat).height).toBeGreaterThanOrEqual(410)
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThan(56)
    },
}

/** Task 4's chat-history takeover: the centre column's chat slot holds a full-region pane instead
 *  of the composer, and `chatFills` gives it the column's full remaining height rather than the
 *  content-height box the resting composer gets — without it this pane would render as a sliver. */
export const HistoryOpen: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps(IDLE_SNAPSHOT, 'idle', {
                    chat: <HistoryStub />,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const hub = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        // The face is not compact here (history can open with no transcript at all), so the column
        // splits evenly between it and the pane rather than giving the pane most of the column the
        // way compact `Conversing` does — the point this story proves is `chatFills`' own job:
        // clearing Awake's resting content-height fraction (<= 0.4) by a wide margin, never a sliver.
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeGreaterThanOrEqual(0.45)
    },
}

/** A split-down pane only 332px tall: the stage scrolls a usable row, so the panels and the face
 *  stay whole instead of being crushed to slivers. */
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
        await assertLayout(canvasElement, { chat: true })
        // Nothing clipped by the page's own overflow:hidden boundary — the only real clipping
        // ancestor. The glyph row's own padding/negative-margin trick (DaemonFace.module.css,
        // covering the bracket glyphs' full height) legitimately paints a little above its flow
        // box, so checking against the hub's box rather than the page's would be a false positive.
        const page = rect(
            canvasElement.querySelector('[data-testid="daemon-page"]')!,
        )
        const face = rect(
            canvasElement.querySelector('[data-testid="daemon-face"]')!,
        )
        await expect(face.top).toBeGreaterThanOrEqual(page.top - 1)
        await expect(face.bottom).toBeLessThanOrEqual(page.bottom + 1)
        const log =
            canvas(canvasElement).getByText('log').parentElement!.parentElement!
        await expect(rect(log).height).toBeGreaterThan(90)
    },
}

/** Whether Host's render ran under a reactive owner — asserted in its play(). */
let hostOwned = false

const noNames = () => []

/** The real container against the global fakeTransport: polls /daemon/snapshot + /daemon/logs,
 *  reads the shared inbox store, and looks up `chatSession(DAEMON_CHAT_ID)` (undefined here — there
 *  is no App in a story to retain one) to hand DaemonChat as the centre column's chat. The composer
 *  renders from first paint with no session behind it; a script's synthetic press/focus
 *  (`isTrusted === false`) must not arm it. */
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
        const composer = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-composer"]',
        )
        await expect(composer).not.toBeNull()
        // Unarmed: a script's synthetic press or focus (isTrusted === false) cannot arm the chat.
        await fireEvent.pointerDown(composer!)
        await fireEvent.focusIn(composer!)
        await expect(daemonChatArmed()).toBe(false)
        await assertLayout(canvasElement, { chat: true })
    },
}
