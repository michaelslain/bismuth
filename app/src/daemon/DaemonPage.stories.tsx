// Visual spec for <DaemonPage> — the daemon's own page, now "hub + full overview": a ViewBar
// carrying identity and the status readout alone (no facet toggle any more — every section shows
// at once), then a two-column stage — DaemonHub (the face, its identity, its own chat) on the
// left, the right column (`props.overview`) on the right.
//
// Every story feeds DaemonPage a REAL `<DaemonOverview>` built from the REAL `DaemonInbox`/
// `DaemonCrons`/`DaemonProcesses`/`DaemonLog` over `app/src/ui/_daemonFixtures.ts` fixtures —
// never a stand-in "crons panel" block — so these shots show the real right column, plus a local
// `ChatStub` standing in for the hub's own chat: the REAL `chat/ChatComposerBar.tsx` +
// `chat/ChatControls.tsx` driven by a stub session (`chat/_stubChatSession.ts`), so a layout story
// shows the shipped composer/controls look — never a hand-drawn mono placeholder. `Host` renders
// the real container against the global fakeTransport instead, wiring everything for real.
//
// Busy/talking faces tick every few hundred ms, so two shots of the same mood rarely match — that
// is the face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { getOwner, onCleanup, Show, type JSX } from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import DaemonPage, { type DaemonPageProps } from './DaemonPage'
import DaemonPageHost from './DaemonPageHost'
import { barReadouts } from './daemonPageModel'
import type { DaemonMood } from './daemonFaceModel'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from '../daemonInbox'
import { daemonChatArmed } from './daemonChatArm'
import Text from '../ui/Text'
import ChatComposerBar from '../chat/ChatComposerBar'
import ChatControls from '../chat/ChatControls'
import { makeStubChatSession } from '../chat/_stubChatSession'
import DaemonOverview from './DaemonOverview'
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

const SNAPSHOT = sampleDaemonSnapshot()

/** The right column, built from the REAL list components over the shared fixtures — a full
 *  inbox/crons/services/log, all four sections carrying rows. */
function fullOverview(): JSX.Element {
    return (
        <DaemonOverview
            inbox={
                <DaemonInbox
                    pages={sampleDaemonPages()}
                    onOpen={noop}
                    onChanged={noop}
                />
            }
            crons={
                <DaemonCrons
                    crons={SNAPSHOT.crons}
                    daemonRunning
                    onOpen={noop}
                    onRun={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            }
            services={
                <DaemonProcesses
                    processes={SNAPSHOT.processes}
                    daemonRunning
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            }
            log={<DaemonLog events={sampleActivity()} />}
        />
    )
}

/** The right column with every section empty — nothing due, no crons, no services, no log —
 *  proving the empty copy in each section rather than a blank hole. */
function emptyOverview(): JSX.Element {
    return (
        <DaemonOverview
            inbox={<DaemonInbox pages={[]} onOpen={noop} onChanged={noop} />}
            crons={
                <DaemonCrons
                    crons={[]}
                    daemonRunning
                    onOpen={noop}
                    onRun={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            }
            services={
                <DaemonProcesses
                    processes={[]}
                    daemonRunning
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            }
            log={<DaemonLog events={[]} />}
        />
    )
}

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

function pageProps(
    mood: DaemonMood,
    status: string,
    over: Partial<DaemonPageProps> = {},
): DaemonPageProps {
    return {
        name: 'daemon',
        blurb: 'keeps a living model of the vault + reviews it every few hours',
        enabled: true,
        mood,
        readouts: barReadouts(status),
        overview: fullOverview(),
        chat: <ChatStub />,
        conversing: false,
        chatFills: false,
        onEditIdentity: noop,
        ...over,
    }
}

const rect = (el: Element) => el.getBoundingClientRect()

/** The layout contract every enabled page must keep: the face centred in the hub column, the
 *  chat (when present) never wider than that column, and — for the wide grid — the overview
 *  column never narrower than the hub column. `stacked: true` (the narrow stories) skips that
 *  last check: the columns are no longer side by side. */
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
    const overview = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-overview"]',
    )
    if (page!.dataset.enabled === 'true') {
        await expect(overview).not.toBeNull()
        if (!opts.stacked) {
            await expect(rect(overview!).width).toBeGreaterThanOrEqual(
                h.width - 1,
            )
        }
    } else {
        await expect(overview).toBeNull()
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

/** The badge count for a section — the leaf element whose whole text is a bare digit string, so
 *  a row's own age text ("2h ago") is never mistaken for it. `null` when the section carries no
 *  badge at all (log). */
function sectionBadgeCount(section: HTMLElement): number | null {
    const badge = [...section.querySelectorAll<HTMLElement>('*')].find(
        el =>
            el.children.length === 0 && /^\d+$/.test(el.textContent?.trim() ?? ''),
    )
    return badge ? Number(badge.textContent!.trim()) : null
}

/** The number of rows a section actually rendered — the direct children of its body (the last
 *  child of the section root, see DaemonSection.tsx). */
function sectionRowCount(section: HTMLElement): number {
    const body = section.lastElementChild as HTMLElement
    return body.children.length
}

/** Enabled, every section carrying rows: the four sections render in order, no facet toggle
 *  anywhere, and each section's badge matches its own rendered row count. */
export const AwakeFilled: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('idle', 'watching // last: dream 4m ago')}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        await expect(
            canvasElement.querySelector('[role="radiogroup"]'),
        ).toBeNull()
        await expect(canvasElement.querySelector('.segmented')).toBeNull()
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="daemon-section"]',
            ),
        ]
        await expect(sections.map(s => s.dataset.section)).toEqual([
            'inbox',
            'crons',
            'services',
            'log',
        ])
        for (const section of sections) {
            const badge = sectionBadgeCount(section)
            if (badge === null) continue
            await expect(badge).toBe(sectionRowCount(section))
        }
    },
}

/** Enabled, every section empty: the layout holds and all four sections still show, each with
 *  its own empty copy instead of a blank hole. */
export const AwakeEmpty: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('idle', 'watching // nothing has run yet', {
                    overview: emptyOverview(),
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="daemon-section"]',
            ),
        ]
        await expect(sections.map(s => s.dataset.section)).toEqual([
            'inbox',
            'crons',
            'services',
            'log',
        ])
    },
}

/** Inbox pages are due — the status reads "needs you", and the inbox section still shows among
 *  the rest (no facet to steer any more, everything is always visible). */
export const NeedsYou: Story = {
    render: () => (
        <Frame>
            <DaemonPage {...pageProps('alert', 'needs you // 3 due')} />
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
            <DaemonPage {...pageProps('thinking', 'thinking // …')} />
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
                {...pageProps('talking', 'talking', {
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

/** `daemon.enabled: false` — the face sleeps alone with how to wake it. No overview column, no
 *  chat at all. */
export const Off: Story = {
    render: () => (
        <Frame>
            <DaemonPage
                {...pageProps('asleep', 'asleep // daemon is off', {
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
            canvasElement.querySelector('[data-testid="daemon-chat-composer"]'),
        ).toBeNull()
        await expect(
            canvas.getByText(/asleep .* daemon is off/i),
        ).toBeInTheDocument()
    },
}

/** A 640px pane, resting: the hub and the overview column stack in a scrolling stage. */
export const Narrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage {...pageProps('busy', 'needs you // 2 due')} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, stacked: true })
        const hub = canvasElement.querySelector(
            '[data-testid="daemon-page-hub"]',
        )!
        const overview = canvasElement.querySelector(
            '[data-testid="daemon-page-overview"]',
        )!
        await expect(rect(hub).top).toBeLessThan(rect(overview).top)
        // The hub must not claim the whole stage height for itself — the overview column that
        // follows it has to start on-screen, not below the fold.
        await expect(rect(overview).top).toBeLessThan(window.innerHeight)
        const trail = canvasElement.querySelector<HTMLElement>(
            '[data-testid="vb-trail"]',
        )!
        await expect(trail.scrollWidth).toBeLessThanOrEqual(trail.clientWidth)
    },
}

/** A 480px pane: the four sections stack under the hub, in order, with no facet toggle to
 *  collide with anything — there's nothing left to collapse at this width but the sections
 *  themselves stacking. */
export const Narrow480: Story = {
    render: () => (
        <Frame width="480px">
            <DaemonPage {...pageProps('idle', 'watching')} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true, stacked: true })
        const hub = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-hub"]',
        )!
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid="daemon-section"]',
            ),
        ]
        await expect(sections.length).toBe(4)
        await expect(sections.map(s => s.dataset.section)).toEqual([
            'inbox',
            'crons',
            'services',
            'log',
        ])
        const hubBottom = rect(hub).bottom
        for (const section of sections) {
            await expect(rect(section).top).toBeGreaterThanOrEqual(
                hubBottom - 1,
            )
        }
        for (let i = 1; i < sections.length; i++) {
            await expect(rect(sections[i]).top).toBeGreaterThanOrEqual(
                rect(sections[i - 1]).top,
            )
        }
    },
}

/** Narrow AND conversing: the chat holds a fixed box, with the compact face above it. */
export const ConversingNarrow: Story = {
    render: () => (
        <Frame width="640px">
            <DaemonPage
                {...pageProps('talking', 'talking', {
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
                {...pageProps('idle', 'watching // last: dream 4m ago', {
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
 *  sections and the face to slivers. */
export const ShortPane: Story = {
    render: () => (
        <Frame height="332px">
            <DaemonPage {...pageProps('busy', 'needs you // 2 due')} />
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
        const overview = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="daemon-page-overview"]',
            )!
        // Every section shows at once now, so "morning-brief" (the cron name) can legitimately
        // appear more than once — in the crons row AND in the log's own entries for it — where
        // the old single-facet panel only ever showed it once. Any match proves the data landed.
        await waitFor(
            () =>
                expect(
                    within(overview()).getAllByText('morning-brief').length,
                ).toBeGreaterThan(0),
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
