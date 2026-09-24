// Visual spec for <DaemonPage> — the daemon's own page, "hub + one panel": a ViewBar carrying the
// facet toggle (inbox/crons/services/log, each with its own count) and the status readout
// alone, then a two-column stage — DaemonHub (the face, its identity, its own chat) on the left,
// whichever ONE panel the current facet names on the right.
//
// DaemonPage is presentational, so every story feeds it fixtures + a stand-in `panel` (a plain
// block naming the facet — the real panels' own looks are DaemonCrons/DaemonProcesses/
// DaemonInbox/DaemonLog's own stories, not this layout story's concern) and a local
// `ChatStub` standing in for the hub's own chat: the REAL `chat/ChatComposerBar.tsx` +
// `chat/ChatControls.tsx` driven by a stub session (`chat/_stubChatSession.ts`), so a layout story
// shows the shipped composer/controls look — never a hand-drawn mono placeholder — plus a plain
// transcript-shaped block when `conversing`. `Host` renders the real container against the global
// fakeTransport instead, wiring real panels.
//
// Busy/talking faces tick every few hundred ms, so two shots of the same mood rarely match — that
// is the face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { getOwner, onCleanup, Show, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import DaemonPage, { type DaemonPageProps, type DaemonFacetCounts } from './DaemonPage'
import DaemonPageHost from './DaemonPageHost'
import { barReadouts, type DaemonFacet } from './daemonPageModel'
import type { DaemonMood } from './daemonFaceModel'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from '../daemonInbox'
import { daemonChatArmed } from './daemonChatArm'
import Text from '../ui/Text'
import ChatComposerBar from '../chat/ChatComposerBar'
import ChatControls from '../chat/ChatControls'
import { makeStubChatSession } from '../chat/_stubChatSession'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonInbox from './DaemonInbox'
import DaemonLog from './DaemonLog'
import {
    sampleDaemonSnapshot,
    sampleDaemonPages,
    sampleActivity,
} from '../ui/_daemonFixtures'

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

/** A stand-in for whichever facet's real panel — proving the SLOT works, not any one panel's own
 *  look (each has its own stories). */
function PanelStub(props: { facet: DaemonFacet }) {
    return (
        <div
            data-testid="panel-stub"
            style={{ padding: 'var(--sp-4)', height: '100%' }}
        >
            <Text size="ui" tone="muted">
                {props.facet} panel
            </Text>
        </div>
    )
}

/** The per-facet Awake* stories render the REAL presentational panel (their own look is each
 *  panel's own stories' concern) instead of PanelStub, so these shots actually show what the
 *  facet looks like — noop callbacks, this is a layout story. */
const SNAPSHOT = sampleDaemonSnapshot()
const cronsPanel = (
    <DaemonCrons
        crons={SNAPSHOT.crons}
        daemonRunning
        onOpen={noop}
        onRun={noop}
        onToggle={noop}
        onCreate={async () => {}}
        onDelete={async () => {}}
    />
)
const servicesPanel = (
    <DaemonProcesses
        processes={SNAPSHOT.processes}
        daemonRunning
        onOpen={noop}
        onToggle={noop}
        onCreate={async () => {}}
        onDelete={async () => {}}
    />
)
const inboxPanel = (
    <DaemonInbox pages={sampleDaemonPages()} onOpen={noop} onChanged={noop} />
)
const logPanel = <DaemonLog events={sampleActivity()} />

/** The hub's `chat` slot for every story: the REAL `ChatComposerBar` with the REAL `ChatControls`
 *  as its `below` — exactly what `daemon/DaemonChat.tsx` renders — driven by a freshly-built stub
 *  session (`chat/_stubChatSession.ts`) so the composer box, placeholder and controls row read as
 *  the shipped daemon-chat look, not a hand-drawn mono mockup. With `tall`, also a plain
 *  transcript-shaped block above it that fills the rest of the column — standing in for
 *  `ChatTranscript`, whose own look belongs to `chat/ChatTranscript.stories.tsx`, not here. */
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
                noteNames={() => []}
                memoryNames={() => []}
                tagNames={() => []}
                below={<ChatControls session={session} />}
            />
        </div>
    )
}

/** A stub standing in for `chat/ChatHistoryPanel.tsx` when it has taken over the hub's chat
 *  region — a full-height list, never a sliver, which is exactly what `chatFills` exists to
 *  prove: without it this pane would render in the content-height box the resting composer gets
 *  instead of the column's full remaining height. */
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

const DEFAULT_COUNTS: DaemonFacetCounts = {
    due: 0,
    crons: 4,
    services: 2,
}

function pageProps(
    mood: DaemonMood,
    facet: DaemonFacet,
    status: string,
    over: Partial<DaemonPageProps> = {},
): DaemonPageProps {
    const counts = over.counts ?? DEFAULT_COUNTS
    return {
        name: 'daemon',
        blurb: 'keeps a living model of the vault + reviews it every few hours',
        enabled: true,
        mood,
        readouts: barReadouts(status),
        facet,
        onFacet: noop,
        counts,
        panel: <PanelStub facet={facet} />,
        chat: <ChatStub />,
        conversing: false,
        chatFills: false,
        onEditIdentity: noop,
        ...over,
    }
}

const rect = (el: Element) => el.getBoundingClientRect()

/** The bounding rect of the last child of `el` that actually takes up space — skipping
 *  `display:none` elements (a dropped BarLabel count) and empty text nodes. A plain text node
 *  has no `getBoundingClientRect`, so it is measured via a Range instead. */
function lastVisibleChildRect(el: Element): DOMRect {
    const nodes = [...el.childNodes]
    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i]
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (getComputedStyle(node as Element).display === 'none') continue
            return (node as Element).getBoundingClientRect()
        }
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            const range = document.createRange()
            range.selectNodeContents(node)
            return range.getBoundingClientRect()
        }
    }
    throw new Error('no visible child found')
}

/** The layout contract every enabled page must keep: the face centred in the hub column, the
 *  chat (when present) never wider than that column, and — for the wide grid — the panel column
 *  never narrower than the hub column. `stacked: true` (the narrow story) skips that last check:
 *  the columns are no longer side by side. */
async function assertLayout(
    canvasElement: HTMLElement,
    opts: { chat: boolean; stacked?: boolean; compact?: boolean },
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
    // Resting: the face is centred in the hub column. Compact (chatFills) — the one-line header
    // form, see DaemonHub — it rides left-aligned at the top instead, flush with the hub column.
    if (!opts.compact) {
        await expect(
            Math.abs(f.left + f.width / 2 - (h.left + h.width / 2)),
        ).toBeLessThanOrEqual(8)
    } else {
        await expect(Math.abs(f.left - h.left)).toBeLessThanOrEqual(24)
    }

    const p = rect(page!)
    const panel = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-panel"]',
    )
    if (page!.dataset.enabled === 'true') {
        await expect(panel).not.toBeNull()
        if (!opts.stacked) {
            await expect(rect(panel!).width).toBeGreaterThanOrEqual(
                h.width - 1,
            )
        }
    } else {
        await expect(panel).toBeNull()
    }

    const chat = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-chat"]',
    )
    if (opts.chat) {
        await expect(chat).not.toBeNull()
        const c = rect(chat!)
        // The composer's edges sit INSIDE the hub column, never wider — and never a full-width
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

export const AwakeInbox: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('alert', 'inbox', 'needs you // 2 due', {
                    counts: { ...DEFAULT_COUNTS, due: 2 },
                    panel: inboxPanel,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeGreaterThan(24)
        // Resting = the full face, never scaled up past the compact/one-line-header ceiling.
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThanOrEqual(42)
    },
}

export const AwakeCrons: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('idle', 'crons', 'watching // last: dream 4m ago', {
                    panel: cronsPanel,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        // The resting face sits HIGH in the hub column, not dead centre (baseline ~45%) — its
        // vertical centre stays inside the column's own upper third.
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        const hub = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-hub"]',
        )!
        const f = rect(face)
        const h = rect(hub)
        const centreFraction = (f.top + f.height / 2 - h.top) / h.height
        await expect(centreFraction).toBeLessThanOrEqual(0.35)

        // Wide: the crons count still shows after the word, with a visible gap between them —
        // the collapse ladder that drops it at 480px hasn't fired here.
        const toggle = canvasElement.querySelector<HTMLElement>('.segmented')!
        const cronsButton = [...toggle.querySelectorAll('button')].find(b =>
            b.textContent?.toLowerCase().startsWith('crons'),
        )!
        const label = cronsButton.querySelector('span')!
        const barLabel = label.querySelector('[data-bar-label]') as HTMLElement
        await expect(getComputedStyle(barLabel).display).not.toBe('none')
        const wordRange = document.createRange()
        wordRange.selectNodeContents(label.childNodes[0])
        const wordRect = wordRange.getBoundingClientRect()
        const countRect = barLabel.getBoundingClientRect()
        await expect(countRect.left - wordRect.right).toBeGreaterThan(2)
    },
}

export const AwakeServices: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('idle', 'services', 'watching // last: dream 4m ago', {
                    panel: servicesPanel,
                })}
            />
        </Frame>
    ),
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
}

export const AwakeLog: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('busy', 'log', 'working // dream', {
                    panel: logPanel,
                })}
            />
        </Frame>
    ),
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
}

/** Inbox pages are due: the page opens on the inbox facet and the segment reads its count. */
export const NeedsYou: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('alert', 'inbox', 'needs you // 3 due', {
                    counts: { ...DEFAULT_COUNTS, due: 3 },
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const canvas = within(canvasElement)
        await expect(canvas.getByText('inbox')).toBeInTheDocument()
    },
}

/** The daemon chat is busy but no reply text has streamed yet — calm `thinking` eyes. */
export const Thinking: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('thinking', 'crons', 'thinking // …')}
            />
        </Frame>
    ),
    play: ({ canvasElement }) => assertLayout(canvasElement, { chat: true }),
}

/** Messages exist: the hub's face collapses to a one-line header and the chat fills the rest of
 *  the column. */
export const Conversing: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('talking', 'crons', 'talking', {
                    chat: <ChatStub tall />,
                    conversing: true,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, compact: true })
        const hub = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeGreaterThanOrEqual(0.5)
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThan(30)
    },
}

/** `daemon.enabled: false` — the face sleeps alone with how to wake it. No facet, no panel, no
 *  chat at all. */
export const Off: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('asleep', 'crons', 'asleep // daemon is off', {
                    enabled: false,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: false })
        const canvas = within(canvasElement)
        // No title any more — the off line stands alone, lowercase, no trailing period.
        await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull()
        await expect(
            canvas.getByText('set daemon.enabled: true in .settings to wake it'),
        ).toBeInTheDocument()
        await expect(
            canvasElement.querySelector('[data-testid="vb-facet"]'),
        ).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="daemon-chat-composer"]'),
        ).toBeNull()
        await expect(
            canvas.getByText(/asleep .* daemon is off/i),
        ).toBeInTheDocument()
    },
}

/** A 640px pane, resting: the hub and the panel stack in a scrolling stage. */
export const Narrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage
                {...pageProps('busy', 'inbox', 'needs you // 2 due', {
                    counts: { ...DEFAULT_COUNTS, due: 2 },
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, stacked: true })
        const hub = canvasElement.querySelector(
            '[data-testid="daemon-page-hub"]',
        )!
        const panel = canvasElement.querySelector(
            '[data-testid="daemon-page-panel"]',
        )!
        await expect(rect(hub).top).toBeLessThan(rect(panel).top)
        // The hub must not claim the whole stage height for itself — the panel that follows it
        // has to start on-screen, not below the fold.
        await expect(rect(panel).top).toBeLessThan(window.innerHeight)
        const trail = canvasElement.querySelector<HTMLElement>(
            '[data-testid="vb-trail"]',
        )!
        await expect(trail.scrollWidth).toBeLessThanOrEqual(trail.clientWidth)
    },
}

/** A 480px pane: the ViewBar's facet region (the four inbox/crons/services/log words) has to fit
 *  without overflowing itself or colliding with the readouts on its right — the counts (BarLabel
 *  `drop="late"`, ui/ViewBar.module.css's ladder fires at this exact width) give way first, the
 *  words themselves never do. */
export const Narrow480: Story = {
    render: () => (
        <Frame width="480px">
            <DaemonPage
                {...pageProps('idle', 'crons', 'watching', {
                    panel: cronsPanel,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, stacked: true })
        // The SegmentedToggle root's own parentElement is the facet region — ViewBar wraps every
        // slot in a region whose class is hashed, so this is reached by DOM structure + a stable
        // global marker class, never a match on that hashed name.
        const toggle = canvasElement.querySelector<HTMLElement>('.segmented')!
        const facetRegion = toggle.parentElement!
        await expect(facetRegion.scrollWidth).toBeLessThanOrEqual(
            facetRegion.clientWidth,
        )

        const readouts = canvasElement.querySelector<HTMLElement>(
            '[data-testid="vb-readouts"]',
        )!
        const fr = facetRegion.getBoundingClientRect()
        const rr = readouts.getBoundingClientRect()
        const overlaps = fr.right > rr.left && fr.left < rr.right
        await expect(overlaps).toBe(false)

        // All four facet words stay visible — only their counts are allowed to drop.
        const buttons = [...toggle.querySelectorAll('button')]
        await expect(buttons.length).toBe(4)
        for (const word of ['inbox', 'crons', 'services', 'log']) {
            const shown = buttons.some(b =>
                b.textContent?.toLowerCase().includes(word),
            )
            await expect(shown).toBe(true)
        }

        // The dropped count must not leave a dead gap behind: the label's rendered text carries
        // no trailing whitespace, and the label's own right edge sits flush with the last
        // VISIBLE child's right edge (the count span is `display:none` at this width, so its
        // flex gap collapses with it — a wrapping element around it would keep the gap instead).
        for (const button of buttons) {
            const label = button.querySelector('span')!
            await expect(label.innerText.trimEnd()).toBe(label.innerText)
            const lastVisible = lastVisibleChildRect(label)
            const labelRect = label.getBoundingClientRect()
            await expect(
                Math.abs(labelRect.right - lastVisible.right),
            ).toBeLessThanOrEqual(1)
        }
    },
}

/** Narrow AND conversing: the chat holds a fixed box, with the compact face above it. */
export const ConversingNarrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage
                {...pageProps('talking', 'crons', 'talking', {
                    chat: <ChatStub tall />,
                    conversing: true,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, {
            chat: true,
            stacked: true,
            compact: true,
        })
        const face = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-face"]',
        )!
        await expect(
            parseFloat(getComputedStyle(face).fontSize),
        ).toBeLessThan(30)
    },
}

/** Task 4's chat-history takeover: the hub's chat slot holds a full-region pane instead of the
 *  composer, and `chatFills` gives it the column's full remaining height. */
export const HistoryOpen: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('idle', 'crons', 'watching // last: dream 4m ago', {
                    chat: <HistoryStub />,
                    chatFills: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, compact: true })
        const hub = canvasElement.querySelector('[data-testid="daemon-page-hub"]')!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeGreaterThanOrEqual(0.5)
    },
}

/** A split-down pane only 332px tall: the stage scrolls a usable row instead of crushing the
 *  panels and the face to slivers. */
export const ShortPane: Story = {
    render: () => (
        <Frame height="332px">
            <DaemonPage
                {...pageProps('busy', 'inbox', 'needs you // 2 due', {
                    counts: { ...DEFAULT_COUNTS, due: 2 },
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const page = rect(
            canvasElement.querySelector('[data-testid="daemon-page"]')!,
        )
        const face = rect(
            canvasElement.querySelector('[data-testid="daemon-face"]')!,
        )
        await expect(face.top).toBeGreaterThanOrEqual(page.top - 1)
        await expect(face.bottom).toBeLessThanOrEqual(page.bottom + 1)
    },
}

/** Whether Host's render ran under a reactive owner — asserted in its play(). */
let hostOwned = false

const noNames = () => []

/** The real container against the global fakeTransport: polls /daemon/snapshot + /daemon/logs,
 *  reads the shared inbox store, and looks up `chatSession(DAEMON_CHAT_ID)` (undefined here —
 *  there is no App in a story to retain one) to hand DaemonChat as the hub's chat. The composer
 *  renders from first paint with no session behind it; a script's synthetic press/focus
 *  (`isTrusted === false`) must not arm it. */
export const Host: Story = {
    render: () => {
        // `onCleanup` only runs under a reactive owner; unowned it is a silent no-op and the
        // settings write below would leak into every later story (GraphView.stories
        // MiniModeSwitcher documents the same trap). play() fails loudly if that ever happens.
        hostOwned = getOwner() !== null
        try {
            localStorage.removeItem('bismuth.daemonFacet.main')
        } catch {
            /* ignore */
        }
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
        const panel = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="daemon-page-panel"]',
            )!
        await waitFor(
            () =>
                expect(
                    within(panel()).getByText('morning-brief'),
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
