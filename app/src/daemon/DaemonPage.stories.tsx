// Visual spec for <DaemonPage> — the daemon's own page, now "hub + full overview": a ViewBar
// carrying identity and the status readout alone (no facet toggle any more — every section shows
// at once), then a two-column stage — DaemonHub (the face, its identity, its own chat) on the
// left, the right column (`props.overview`) on the right.
//
// Every story feeds DaemonPage a REAL `<DaemonOverview>` built from the REAL `DaemonInbox`/
// `DaemonCrons`/`DaemonProcesses`/`DaemonLog` over `app/src/ui/_daemonFixtures.ts` fixtures —
// never a stand-in "crons panel" block — so these shots show the real right column, plus a local
// `ChatStub` standing in for the hub's own chat: the REAL `DaemonChat.tsx` (composer bar +
// controls + transcript) driven by a stub session (`chat/_stubChatSession.ts`), so a layout story
// shows the shipped composer/controls look — never a hand-drawn mono placeholder. `Host` renders
// the real container against the global fakeTransport instead, wiring everything for real.
//
// Busy/talking faces tick every few hundred ms, so two shots of the same mood rarely match — that
// is the face working, not flake.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import {
    createMemo,
    createSignal,
    getOwner,
    Match,
    onCleanup,
    Switch,
    type JSX,
} from 'solid-js'
import { expect, fireEvent, waitFor, within } from 'storybook/test'
import DaemonPage, { type DaemonPageProps } from './DaemonPage'
import DaemonPageHost from './DaemonPageHost'
import { barReadouts } from './daemonPageModel'
import type { DaemonMood } from './daemonFaceModel'
import { settings, setSettings } from '../settings'
import { refreshDaemonPages } from './daemonInboxApi'
import { daemonChatArmed } from './daemonChatArm'
import DaemonChat from './DaemonChat'
import { makeStubChatSession } from '../chat/_stubChatSession'
import { CONVERSATION_ITEMS } from '../chat/_transcriptFixtures'
import DaemonOverview, {
    type DaemonOverviewProps,
    type DaemonSectionKey,
} from './DaemonOverview'
import DaemonTakeover from './DaemonTakeover'
import DaemonCrons from './DaemonCrons'
import DaemonProcesses from './DaemonProcesses'
import DaemonInbox from './DaemonInbox'
import DaemonLog from './DaemonLog'
import {
    dueSorted,
    failedSorted,
    scheduledSorted,
    resolvedSorted,
} from './daemonInboxLogic'
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
        inbox: {
            total: due + failed + scheduled,
            attention: due + failed,
            extraLines: resolved > 0 ? 1 : 0,
        },
        crons: {
            total: crons.length,
            attention: crons.filter(c => cronNeedsAttention(c, daemonRunning))
                .length,
        },
        services: {
            total: processes.length,
            attention: processes.filter(p =>
                processNeedsAttention(p, daemonRunning),
            ).length,
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
            rows={overviewRows(
                pages,
                SNAPSHOT.crons,
                SNAPSHOT.processes,
                events,
                true,
            )}
            inbox={limit => (
                <DaemonInbox
                    pages={pages}
                    limit={limit()}
                    onOpenSection={noop}
                    onOpen={noop}
                    onChanged={noop}
                />
            )}
            crons={limit => (
                <DaemonCrons
                    crons={SNAPSHOT.crons}
                    daemonRunning
                    limit={limit()}
                    onOpenSection={noop}
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
                    onOpenSection={noop}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => (
                <DaemonLog
                    events={events}
                    limit={limit()}
                    onOpenSection={noop}
                />
            )}
        />
    )
}

/** The right column with every section empty — nothing due, no crons, no services, no log —
 *  proving the empty copy in each section rather than a blank hole. */
function emptyOverview(): JSX.Element {
    return (
        <DaemonOverview
            rows={overviewRows([], [], [], [], true)}
            inbox={limit => (
                <DaemonInbox
                    pages={[]}
                    limit={limit()}
                    onOpenSection={noop}
                    onOpen={noop}
                    onChanged={noop}
                />
            )}
            crons={limit => (
                <DaemonCrons
                    crons={[]}
                    daemonRunning
                    limit={limit()}
                    onOpenSection={noop}
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
                    onOpenSection={noop}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => (
                <DaemonLog events={[]} limit={limit()} onOpenSection={noop} />
            )}
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
                ? {
                      timestamp: new Date().toISOString(),
                      result: 'failed',
                      detail: 'boom',
                  }
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
            inbox={limit => (
                <DaemonInbox
                    pages={pages}
                    limit={limit()}
                    onOpenSection={noop}
                    onOpen={noop}
                    onChanged={noop}
                />
            )}
            crons={limit => (
                <DaemonCrons
                    crons={crons}
                    daemonRunning
                    limit={limit()}
                    onOpenSection={noop}
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
                    onOpenSection={noop}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => (
                <DaemonLog
                    events={events}
                    limit={limit()}
                    onOpenSection={noop}
                />
            )}
        />
    )
    return { overview, crons }
}

/** The hub's `chat` slot for every story: the REAL `DaemonChat` (`daemon/DaemonChat.tsx` —
 *  composer bar, controls row and, once there are messages, the real `ChatTranscript`) driven by a
 *  freshly-built stub session (`chat/_stubChatSession.ts`), so the composer, the controls and the
 *  conversing transcript read as the shipped daemon-chat look, not a hand-drawn mockup. With
 *  `tall` the session holds a short conversation, so the transcript fills the column above the
 *  composer exactly as it does in the app. */
function ChatStub(props: { tall?: boolean }) {
    return (
        <DaemonChat
            session={makeStubChatSession({
                transcript: props.tall ? [...CONVERSATION_ITEMS] : [],
                persona: 'daemon',
            })}
            name="daemon"
            onGesture={() => {}}
            noteNames={() => []}
            memoryNames={() => []}
            tagNames={() => []}
        />
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
 *  column `clamp(340px, 34%, 460px)` wide, sharing the hub box's top and bottom. `stacked: true`
 *  (the narrow stories) skips that last check: the columns are no longer side by side. */
async function assertLayout(
    canvasElement: HTMLElement,
    opts: {
        chat: boolean
        stacked?: boolean
        compact?: boolean
        /** Messages exist: the hub has no face at all (it rides the transcript instead). */
        conversing?: boolean
    },
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
    await expect(hub).not.toBeNull()
    const h = rect(hub!)
    // Conversing: no hub face — the transcript's lowest assistant row carries it, as a small
    // avatar INSIDE the chat (never the resting hero).
    if (opts.conversing) {
        await expect(
            page!.querySelector('[data-testid="daemon-face-region"]'),
        ).toBeNull()
        const chat = page!.querySelector('[data-testid="daemon-page-chat"]')!
        await expect(chat.contains(face)).toBe(true)
        await expect(
            parseFloat(getComputedStyle(face as Element).fontSize),
        ).toBeLessThan(26)
    } else {
        await expect(face).not.toBeNull()
        await expect(rect(face!).width).toBeGreaterThan(0)
    }
    const f = face && !opts.conversing ? rect(face) : undefined
    // Resting: the face is centred in the hub column. Compact (chatFills) — the one-line header
    // form, see DaemonHub — it rides left-aligned at the top instead, flush with the hub column.
    if (f && !opts.compact) {
        await expect(
            Math.abs(f.left + f.width / 2 - (h.left + h.width / 2)),
        ).toBeLessThanOrEqual(8)
    } else if (f) {
        await expect(Math.abs(f.left - h.left)).toBeLessThanOrEqual(24)
    }

    const p = rect(page!)
    const overview = page!.querySelector<HTMLElement>(
        '[data-testid="daemon-page-overview"]',
    )
    if (page!.dataset.enabled === 'true') {
        await expect(overview).not.toBeNull()
        if (!opts.stacked) {
            // The right column is `clamp(340px, 34%, 460px)` wide; the hub box and the column
            // share top and bottom edges.
            const o = rect(overview!)
            await expect(o.width).toBeGreaterThanOrEqual(339)
            await expect(o.width).toBeLessThanOrEqual(461)
            await expect(Math.abs(o.top - h.top)).toBeLessThanOrEqual(1)
            await expect(Math.abs(o.bottom - h.bottom)).toBeLessThanOrEqual(1)
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
            el.children.length === 0 &&
            /^\d+$/.test(el.textContent?.trim() ?? ''),
    )
    return badge ? Number(badge.textContent!.trim()) : null
}

/** The number of rows a section actually rendered — real row components only (DaemonRow,
 *  InboxRow), never a section's own structural children (heading, badge, trailing "N resolved"
 *  line). */
function sectionRowCount(section: HTMLElement): number {
    return section.querySelectorAll(
        '[data-testid="daemon-row"], [data-testid="inbox-row"]',
    ).length
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
        await expect(
            sections.map(s => s.dataset.testid!.replace('daemon-section-', '')),
        ).toEqual(['inbox', 'crons', 'services', 'log'])
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
        await expect(
            sections.map(s => s.dataset.testid!.replace('daemon-section-', '')),
        ).toEqual(['inbox', 'crons', 'services', 'log'])
    },
}

/** A large fixture — 12 crons (one failed, late in the list), 10 services, 8 inbox pages, 60 log
 *  events — in the standard wide frame: the dynamic row budget keeps every section's heading
 *  visible with no scroll at rest, and the failed cron is never hidden behind a limit despite its
 *  position in the source list. The more-lines open the section full screen (the Opened* stories). */
export const AwakeCrowded: Story = {
    render: () => {
        const { overview } = crowdedOverview()
        return (
            <Frame>
                <DaemonPage
                    {...pageProps('busy', 'needs you // 8 due', { overview })}
                />
            </Frame>
        )
    },
    play: async ({ canvasElement }) => {
        await assertLayout(canvasElement, { chat: true })
        const overviewEl = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-overview"] [data-testid="daemon-overview"]',
        )!
        await expect(overviewEl.scrollHeight).toBeLessThanOrEqual(
            overviewEl.clientHeight + 1,
        )
        const sections = [
            ...canvasElement.querySelectorAll<HTMLElement>(
                '[data-testid^="daemon-section-"]',
            ),
        ]
        await expect(
            sections.map(s => s.dataset.testid!.replace('daemon-section-', '')),
        ).toEqual(['inbox', 'crons', 'services', 'log'])
        for (const section of sections) {
            await expect(section.offsetHeight).toBeGreaterThan(0)
        }
        await expect(
            canvasElement.querySelectorAll('[data-testid="daemon-more-line"]')
                .length,
        ).toBeGreaterThan(0)
        const cronsSection = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-section-crons"]',
        )!
        const cronRows = [
            ...cronsSection.querySelectorAll<HTMLElement>(
                '[data-testid="daemon-row"]',
            ),
        ]
        await expect(
            cronRows.some(r => r.textContent?.includes('cron-10')),
        ).toBe(true)
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

/** Messages exist: the hub's face region goes (the face rides the transcript's lowest assistant
 *  row instead) and the chat fills the column. */
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
        await assertLayout(canvasElement, { chat: true, conversing: true })
        const hub = canvasElement.querySelector(
            '[data-testid="daemon-page-hub"]',
        )!
        const chat = canvasElement.querySelector(
            '[data-testid="daemon-page-chat"]',
        )!
        await expect(
            rect(chat).height / rect(hub).height,
        ).toBeGreaterThanOrEqual(0.5)
        // At this wide width the transcript's turn column and the composer share ONE left edge
        // (both are capped at --chat-column and centred), not a transcript wider than the bar.
        const turn = within(canvasElement).getByText(
            'What changed in the last release?',
        )
        const composer = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-chat-composer"]',
        )!
        // The composer's own box is the descendant capped at --chat-column (the wrapper and bar
        // around it are full width).
        // `--chat-column` resolved through a probe element (a hard-coded `680px` here would fail
        // confusingly the day the token changes).
        const probe = document.createElement('div')
        probe.style.maxWidth = 'var(--chat-column)'
        composer.appendChild(probe)
        const column = getComputedStyle(probe).maxWidth
        probe.remove()
        await expect(column).not.toBe('none')
        const box = [...composer.querySelectorAll<HTMLElement>('*')].find(
            el => getComputedStyle(el).maxWidth === column,
        )
        await expect(box).toBeDefined()
        await expect(
            Math.abs(rect(turn).left - rect(box!).left),
        ).toBeLessThanOrEqual(1)
    },
}

/** The shared assertions of every opened-section story. */
const assertOpened =
    (key: DaemonSectionKey) =>
    async ({ canvasElement }: { canvasElement: HTMLElement }) => {
        const opened = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-opened"]',
        )
        await expect(opened).not.toBeNull()
        await expect(
            canvasElement
                .querySelector<HTMLElement>('[data-testid="daemon-page-hub"]')!
                .getClientRects().length,
        ).toBe(0)
        await expect(
            canvasElement
                .querySelector<HTMLElement>(
                    '[data-testid="daemon-page-overview"]',
                )!
                .getClientRects().length,
        ).toBe(0)
        await expect(
            opened!.querySelector('[data-testid="daemon-takeover"]'),
        ).not.toBeNull()
        await expect(
            opened!.querySelector(
                `[data-testid="daemon-${key === 'services' ? 'processes' : key}-full"]`,
            ),
        ).not.toBeNull()
        const stage = canvasElement.querySelector<HTMLElement>(
            '[data-testid="daemon-page-stage"]',
        )!
        await expect(rect(opened!).width).toBeGreaterThan(
            rect(stage).width * 0.9,
        )
        // The ViewBar locus names the opened section.
        await expect(
            within(canvasElement).getAllByText(key).length,
        ).toBeGreaterThan(1)
    }

/** The opened section's takeover, built from the REAL takeover + `variant="full"` list over the
 *  shared fixtures — what DaemonPageHost hands DaemonPage as `openedView`. */
function openedStory(
    key: DaemonSectionKey,
    view: JSX.Element,
    count?: number,
): Story {
    return {
        render: () => (
            <Frame>
                <DaemonPage
                    {...pageProps('idle', 'watching // last: dream 4m ago', {
                        opened: key,
                        openedView: (
                            <DaemonTakeover
                                title={key}
                                count={count}
                                onClose={noop}
                            >
                                {view}
                            </DaemonTakeover>
                        ),
                    })}
                />
            </Frame>
        ),
    }
}

/** Opened inbox: open pages, then the faint `resolved` sub-heading and resolved pages. */
export const OpenedInbox: Story = {
    ...openedStory(
        'inbox',
        <DaemonInbox
            variant="full"
            pages={sampleDaemonPages()}
            onOpen={noop}
            onChanged={noop}
        />,
        dueSorted(sampleDaemonPages(), Date.now()).length +
            failedSorted(sampleDaemonPages()).length,
    ),
    play: assertOpened('inbox'),
}

/** Opened crons: every row, the takeover scrolls if needed. */
export const OpenedCrons: Story = {
    ...openedStory(
        'crons',
        <DaemonCrons
            variant="full"
            crons={SNAPSHOT.crons}
            daemonRunning
            onOpen={noop}
            onRun={noop}
            onToggle={noop}
            onDelete={async () => {}}
        />,
        SNAPSHOT.crons.length,
    ),
    play: assertOpened('crons'),
}

/** Opened services: every row. */
export const OpenedServices: Story = {
    ...openedStory(
        'services',
        <DaemonProcesses
            variant="full"
            processes={SNAPSHOT.processes}
            daemonRunning
            onOpen={noop}
            onToggle={noop}
            onDelete={async () => {}}
        />,
        SNAPSHOT.processes.length,
    ),
    play: assertOpened('services'),
}

/** Opened log: events grouped under faint day labels. */
export const OpenedLog: Story = {
    ...openedStory(
        'log',
        <DaemonLog variant="full" events={sampleActivity()} />,
    ),
    play: assertOpened('log'),
}

/** The page with every box live: click anywhere on a box (not on one of its rows) and the
 *  section GROWS out of that box to fill the page; `[x close]` (or Esc) shrinks it back into place.
 *  Story-local state stands in for DaemonPageHost — same `opened` / last-opened wiring. */
function interactivePage(): JSX.Element {
    const pages = sampleDaemonPages()
    const events = sampleActivity()
    const [opened, setOpened] = createSignal<DaemonSectionKey | null>(null)
    const lastOpened = createMemo<DaemonSectionKey | null>(
        prev => opened() ?? prev,
        null,
    )
    const close = () => setOpened(null)
    const overview = (
        <DaemonOverview
            rows={overviewRows(
                pages,
                SNAPSHOT.crons,
                SNAPSHOT.processes,
                events,
                true,
            )}
            inbox={limit => (
                <DaemonInbox
                    pages={pages}
                    limit={limit()}
                    onOpenSection={() => setOpened('inbox')}
                    onOpen={noop}
                    onChanged={noop}
                />
            )}
            crons={limit => (
                <DaemonCrons
                    crons={SNAPSHOT.crons}
                    daemonRunning
                    limit={limit()}
                    onOpenSection={() => setOpened('crons')}
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
                    onOpenSection={() => setOpened('services')}
                    onOpen={noop}
                    onToggle={noop}
                    onDelete={async () => {}}
                />
            )}
            log={limit => (
                <DaemonLog
                    events={events}
                    limit={limit()}
                    onOpenSection={() => setOpened('log')}
                />
            )}
        />
    )
    const openedView = (
        <Switch>
            <Match when={lastOpened() === 'inbox'}>
                <DaemonTakeover
                    title="inbox"
                    count={overviewRows(pages, [], [], [], true).inbox.total}
                    onClose={close}
                >
                    <DaemonInbox
                        variant="full"
                        pages={pages}
                        onOpen={noop}
                        onChanged={noop}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'crons'}>
                <DaemonTakeover
                    title="crons"
                    count={SNAPSHOT.crons.length}
                    onClose={close}
                >
                    <DaemonCrons
                        variant="full"
                        crons={SNAPSHOT.crons}
                        daemonRunning
                        onOpen={noop}
                        onRun={noop}
                        onToggle={noop}
                        onDelete={async () => {}}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'services'}>
                <DaemonTakeover
                    title="services"
                    count={SNAPSHOT.processes.length}
                    onClose={close}
                >
                    <DaemonProcesses
                        variant="full"
                        processes={SNAPSHOT.processes}
                        daemonRunning
                        onOpen={noop}
                        onToggle={noop}
                        onDelete={async () => {}}
                    />
                </DaemonTakeover>
            </Match>
            <Match when={lastOpened() === 'log'}>
                <DaemonTakeover title="log" onClose={close}>
                    <DaemonLog variant="full" events={events} />
                </DaemonTakeover>
            </Match>
        </Switch>
    )
    return (
        <Frame>
            <DaemonPage
                {...pageProps('alert', 'needs you // 3 due', {
                    overview,
                    opened: opened(),
                    openedView,
                })}
            />
        </Frame>
    )
}

/** Click any box to open it and watch it grow; close to watch it shrink back. No play — it is
 *  for a person to drive. `GrowAndShrink` below asserts the same motion headlessly. */
export const OpenAnySection: Story = {
    render: () => interactivePage(),
}

/** The motion, asserted: opening keeps the page visible behind the growing box until the grow
 *  ends (`data-moving`), then hides it; closing shows it again and removes the box once it has
 *  shrunk back. */
export const GrowAndShrink: Story = {
    render: () => interactivePage(),
    play: async ({ canvasElement }) => {
        const q = (sel: string) => canvasElement.querySelector<HTMLElement>(sel)
        const visible = (sel: string) =>
            (q(sel)?.getClientRects().length ?? 0) > 0
        await waitFor(() => expect(q('[data-section="crons"]')).not.toBeNull())
        // Bare box space, not a row: the whole box is the target.
        fireEvent.click(q('[data-section="crons"]')!)
        await waitFor(() =>
            expect(
                q('[data-testid="daemon-page-opened"]')?.dataset.moving,
            ).toBe('true'),
        )
        await expect(visible('[data-testid="daemon-page-hub"]')).toBe(true)
        await waitFor(() =>
            expect(
                q('[data-testid="daemon-page-opened"]')?.dataset.moving,
            ).toBe('false'),
        )
        await expect(visible('[data-testid="daemon-page-hub"]')).toBe(false)
        fireEvent.click(q('[data-testid="daemon-takeover-close"]')!)
        await waitFor(() =>
            expect(visible('[data-testid="daemon-page-hub"]')).toBe(true),
        )
        await waitFor(() =>
            expect(q('[data-testid="daemon-page-opened"]')).toBeNull(),
        )
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
            canvas.getByText(
                'set daemon.enabled: true in .settings to wake it',
            ),
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
        await expect(
            sections.map(s => s.dataset.testid!.replace('daemon-section-', '')),
        ).toEqual(['inbox', 'crons', 'services', 'log'])
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

/** Narrow AND conversing: the chat holds a fixed box, no hub face above it. */
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
            conversing: true,
        })
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
