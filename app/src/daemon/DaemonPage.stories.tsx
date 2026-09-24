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
import DaemonOverview, { type DaemonOverviewProps } from './DaemonOverview'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonInbox from './DaemonInbox'
import DaemonLog from './DaemonLog'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from '../daemonInboxLogic'
import { cronNeedsAttention, processNeedsAttention } from './daemonAttention'
import type { DaemonPage as DaemonPageFixture } from '../../../core/src/daemonPages'
import type { DaemonCron, DaemonProcess } from '../../../core/src/daemonGraph'
import type { ActivityEvent } from '../../../core/src/daemonActivity'
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

/** The `rows` DaemonOverview needs to size its dynamic limits — mirrors exactly what
 *  DaemonPageHost derives from a real snapshot (see its own header comment). */
function overviewRows(
    pages: DaemonPageFixture[],
    crons: DaemonCron[],
    processes: DaemonProcess[],
    events: ActivityEvent[],
    daemonRunning: boolean,
): DaemonOverviewProps['rows'] {
    const now = Date.now()
    const due = dueSorted(pages, now).length
    const failed = failedSorted(pages).length
    const scheduled = scheduledSorted(pages, now).length
    const resolved = resolvedSorted(pages).length
    return {
        inbox: { total: due + failed + scheduled, attention: due + failed, extraLines: resolved > 0 ? 1 : 0 },
        crons: {
            total: crons.length,
            attention: crons.filter(c => cronNeedsAttention(c, daemonRunning)).length,
        },
        services: {
            total: processes.length,
            attention: processes.filter(p => processNeedsAttention(p, daemonRunning)).length,
        },
        log: { total: events.length, attention: 0 },
    }
}

/** The right column, built from the REAL list components over the shared fixtures — a full
 *  inbox/crons/services/log, all four sections carrying rows. */
function fullOverview(): JSX.Element {
    const pages = sampleDaemonPages()
    const events = sampleActivity()
    return (
        <DaemonOverview
            rows={overviewRows(pages, SNAPSHOT.crons, SNAPSHOT.processes, events, true)}
            inbox={limit => (
                <DaemonInbox pages={pages} limit={limit()} onOpen={noop} onChanged={noop} />
            )}
            crons={limit => (
                <DaemonCrons
                    crons={SNAPSHOT.crons}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onRun={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            services={limit => (
                <DaemonProcesses
                    processes={SNAPSHOT.processes}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => <DaemonLog events={events} limit={limit()} />}
        />
    )
}

/** The right column with every section empty — nothing due, no crons, no services, no log —
 *  proving the empty copy in each section rather than a blank hole. */
function emptyOverview(): JSX.Element {
    return (
        <DaemonOverview
            rows={overviewRows([], [], [], [], true)}
            inbox={limit => <DaemonInbox pages={[]} limit={limit()} onOpen={noop} onChanged={noop} />}
            crons={limit => (
                <DaemonCrons
                    crons={[]}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onRun={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            services={limit => (
                <DaemonProcesses
                    processes={[]}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => <DaemonLog events={[]} limit={limit()} />}
        />
    )
}

/** A large fixture — 12 crons (one failed, placed late in the list), 10 services, 8 inbox pages,
 *  60 log events — for `AwakeCrowded`: proves the dynamic row budget actually keeps every section
 *  visible at rest in the standard wide frame, with the failed cron never hidden behind a limit
 *  despite its position in the source list (attention-first sorting is DaemonCrons' own job; this
 *  just proves a limit doesn't hide it). */
function crowdedOverview(): {
    overview: JSX.Element
    crons: DaemonCron[]
} {
    const pages: DaemonPageFixture[] = Array.from({ length: 8 }, (_, i) => ({
        path: `.daemon/pages/page-${i}.md`,
        slug: `page-${i}`,
        title: `page ${i}`,
        createdAt: new Date(Date.now() - i * 60_000).toISOString(),
        source: 'cron:crowded',
        actions: [],
        body: '',
        status: 'pending',
    }))
    const crons: DaemonCron[] = Array.from({ length: 12 }, (_, i) => ({
        name: `cron-${i}`,
        file: `cron-${i}`,
        schedule: '0 * * * *',
        on: 'schedule',
        watch: null,
        enabled: true,
        lastFired:
            i === 10
                ? { timestamp: new Date().toISOString(), result: 'failed', detail: 'boom' }
                : { timestamp: new Date().toISOString(), result: 'success' },
        running: false,
        startedAt: null,
    }))
    const processes: DaemonProcess[] = Array.from({ length: 10 }, (_, i) => ({
        name: `service-${i}`,
        file: `service-${i}`,
        enabled: true,
        running: false,
    }))
    const events: ActivityEvent[] = Array.from({ length: 60 }, (_, i) => ({
        ts: new Date(Date.now() - i * 60_000).toISOString(),
        kind: 'cron',
        name: `cron-${i % 12}`,
        event: 'finished',
        outcome: 'success',
        durationMs: 1000,
    }))
    const overview = (
        <DaemonOverview
            rows={overviewRows(pages, crons, processes, events, true)}
            inbox={limit => <DaemonInbox pages={pages} limit={limit()} onOpen={noop} onChanged={noop} />}
            crons={limit => (
                <DaemonCrons
                    crons={crons}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onRun={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            services={limit => (
                <DaemonProcesses
                    processes={processes}
                    daemonRunning
                    limit={limit()}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => <DaemonLog events={events} limit={limit()} />}
        />
    )
    return { overview, crons }
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

/** The number of rows a section actually rendered — real row components only (DaemonRow,
 *  InboxRow), never a section's own structural children (heading, badge, trailing "N resolved"
 *  line). */
function sectionRowCount(section: HTMLElement): number {
    return section.querySelectorAll('[data-testid="daemon-row"], [data-testid="inbox-row"]').length
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
        await expect(canvasElement.querySelector('[data-segmented]')).toBeNull()
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid^="daemon-section-"]',
            ),
        ]
        await expect(sections.map(s => s.dataset.testid!.replace('daemon-section-', ''))).toEqual([
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
                '[data-testid^="daemon-section-"]',
            ),
        ]
        await expect(sections.map(s => s.dataset.testid!.replace('daemon-section-', ''))).toEqual([
            'inbox',
            'crons',
            'services',
            'log',
        ])
    },
}

/** A large fixture — 12 crons (one failed, late in the list), 10 services, 8 inbox pages, 60 log
 *  events — in the standard wide frame: the dynamic row budget keeps every section's heading
 *  visible with no scroll at rest, and the failed cron is never hidden behind a limit despite its
 *  position in the source list. Expanding a more-line then makes the column scroll. */
export const AwakeCrowded: Story = {
    render: () => {
        const { overview } = crowdedOverview()
        return (
            <Frame>
                <DaemonPage {...pageProps('busy', 'needs you // 8 due', { overview })} />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const overviewEl = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-overview"] [data-testid="daemon-overview"]',
        )!
        await expect(overviewEl.scrollHeight).toBeLessThanOrEqual(overviewEl.clientHeight + 1)
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>('[data-testid^="daemon-section-"]'),
        ]
        await expect(sections.map(s => s.dataset.testid!.replace('daemon-section-', ''))).toEqual([
            'inbox',
            'crons',
            'services',
            'log',
        ])
        for (const section of sections) {
            await expect(section.offsetHeight).toBeGreaterThan(0)
        }
        await expect(
            canvasElement.querySelectorAll('[data-testid="daemon-more-line"]').length,
        ).toBeGreaterThan(0)
        const cronsSection = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-section-crons"]',
        )!
        const cronRows = [...cronsSection.querySelectorAll<HTMLElement>('[data-testid="daemon-row"]')]
        await expect(cronRows.some(r => r.textContent?.includes('cron-10'))).toBe(true)
    },
}

/** The crowded page after expanding crons in place: the section shows all 12 and the ONE column
 *  scroll takes over — no section ever scrolls on its own. Kept separate from `AwakeCrowded` so
 *  that story's screenshot is the resting state. */
export const AwakeCrowdedExpanded: Story = {
    render: AwakeCrowded.render,
    play: async ({ canvasElement }) => {
        const overviewEl = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-overview"] [data-testid="daemon-overview"]',
        )!
        const cronsSection = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-section-crons"]',
        )!
        const cronsMoreLine = cronsSection.querySelector<HTMLElement>('[data-testid="daemon-more-line"]')
        await expect(cronsMoreLine).not.toBeNull()
        await fireEvent.click(cronsMoreLine!)
        await waitFor(() =>
            expect(cronsSection.querySelectorAll('[data-testid="daemon-row"]').length).toBe(12),
        )
        await waitFor(() =>
            expect(overviewEl.scrollHeight).toBeGreaterThan(overviewEl.clientHeight),
        )
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
                '[data-testid^="daemon-section-"]',
            ),
        ]
        await expect(sections.length).toBe(4)
        await expect(sections.map(s => s.dataset.testid!.replace('daemon-section-', ''))).toEqual([
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
