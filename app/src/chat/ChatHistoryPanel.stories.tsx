// Visual spec for <ChatHistoryPanel> — the session-history pane body, driven from a plain
// `ChatHistoryState` built per-story (no ChatSession needed; the panel only ever reads this slice).
// Fixture times are anchored to local calendar days (not "now minus N hours"), so the age groups a
// story shows hold at any hour — "now minus 26h" is two calendar days back at 1am.
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, within } from 'storybook/test'
import ChatHistoryPanel from './ChatHistoryPanel'
import type { ChatHistoryState } from './chatSession'
import type { ChatScope, ChatSearchHit, ChatSessionInfo } from '../api'

const meta = {
    title: 'Chat/ChatHistoryPanel',
    component: ChatHistoryPanel,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatHistoryPanel>

export default meta
type Story = StoryObj<typeof meta>

const MIN = 60_000
const ago = (ms: number) => Date.now() - ms
/** Today, `minutes` ago — clamped to today's midnight so it never slips into yesterday. */
const today = (minutes: number) => {
    const n = new Date()
    const midnight = new Date(
        n.getFullYear(),
        n.getMonth(),
        n.getDate(),
    ).getTime()
    return Math.max(midnight, ago(minutes * MIN))
}
/** Noon, `days` local calendar days back. */
const daysBack = (days: number) => {
    const n = new Date()
    return new Date(
        n.getFullYear(),
        n.getMonth(),
        n.getDate() - days,
        12,
    ).getTime()
}

const SESSIONS: ChatSessionInfo[] = [
    {
        sessionId: 's1',
        summary: 'Restyle the daemon page',
        lastModified: today(5),
        origin: 'user',
    },
    {
        sessionId: 's2',
        summary: 'dream — nightly vault review',
        lastModified: today(20),
        origin: 'daemon',
    },
    {
        sessionId: 's3',
        summary:
            'Why does the month grid clip its last two week rows on short panes',
        lastModified: daysBack(1),
        origin: 'user',
    },
    {
        sessionId: 's4',
        summary: 'vault-review — orphaned notes',
        lastModified: daysBack(3),
        origin: 'daemon',
    },
    {
        sessionId: 's5',
        summary: 'Draft the bases query-block docs',
        lastModified: daysBack(5),
        origin: 'user',
    },
    {
        sessionId: 's6',
        summary: 'Pick a serif for note prose',
        lastModified: daysBack(12),
        origin: 'user',
    },
    {
        sessionId: 's7',
        summary: '',
        lastModified: daysBack(48),
        origin: 'user',
    },
]

const HITS: ChatSearchHit[] = [
    {
        sessionId: 's1',
        summary: 'Restyle the daemon page',
        lastModified: today(5),
        origin: 'user',
        snippet: 'the chat controls should be one quiet row…',
        inTitle: false,
    },
    {
        sessionId: 's3',
        summary:
            'Why does the month grid clip its last two week rows on short panes when the event chips wrap onto a second line',
        lastModified: daysBack(1),
        origin: 'user',
        snippet:
            'so the container is clipping the last two rows — the grid is sized from the pane height minus the bar, but the bar grows when the quiet row of chips wraps, and nothing re-measures after that, which is why it only shows on short panes',
        inTitle: false,
    },
    {
        sessionId: 's2',
        summary: 'dream — nightly vault review',
        lastModified: today(20),
        origin: 'daemon',
        snippet: 'consolidated three notes about the quiet row redesign',
        inTitle: false,
    },
]

function makeHistory(init: {
    sessions?: ChatSessionInfo[]
    searchHits?: ChatSearchHit[]
    query?: string
    scope?: ChatScope
    loading?: boolean
    searchLoading?: boolean
}): ChatHistoryState {
    const [open, setOpen] = createSignal(true)
    const [loading] = createSignal(init.loading ?? false)
    const [sessions] = createSignal(init.sessions ?? [])
    const [scope, setScope] = createSignal<ChatScope>(init.scope ?? 'user')
    const [query, setQuery] = createSignal(init.query ?? '')
    const [searchHits] = createSignal(init.searchHits ?? [])
    const [searchLoading] = createSignal(init.searchLoading ?? false)
    return {
        open,
        loading,
        sessions,
        scope,
        query,
        searchHits,
        searchLoading,
        toggle: () => setOpen(v => !v),
        close: () => setOpen(false),
        setScope,
        setQuery,
        resume: async () => {},
    }
}

const Frame = (props: { width?: string; children: any }) => (
    <div
        style={{
            width: props.width ?? '640px',
            height: '560px',
            display: 'flex',
        }}
    >
        {props.children}
    </div>
)

export const List: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ sessions: SESSIONS, scope: 'all' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Restyle the daemon page')).not.toBeNull()
        await expect(canvas.getByText('new chat')).not.toBeNull()
        for (const label of [
            'today',
            'yesterday',
            'past 7 days',
            'past 30 days',
            'older',
        ])
            await expect(canvas.getByText(label)).not.toBeNull()
        await expect(canvas.queryByText(/resume a conversation/i)).toBeNull()
    },
}

/** Up/Down from the prompt walk the rows; the reached row takes the selected paint. */
export const KeyboardCursor: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ sessions: SESSIONS, scope: 'all' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="conversations"]',
        )!
        input.focus()
        await userEvent.keyboard('{ArrowDown}{ArrowDown}')
        const active = canvasElement.querySelectorAll('[data-selected]')
        await expect(active.length).toBe(1)
        await expect(active[0].textContent).toContain('dream')
        // the focused input names the cursor row, so assistive tech announces it
        await expect(input.getAttribute('aria-activedescendant')).toBe(active[0].id)
        await expect(active[0].id).toMatch(/^chat-history-row-\d+$/)
    },
}

export const Search: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({
                    sessions: SESSIONS,
                    searchHits: HITS,
                    query: 'quiet row',
                })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="conversations"]',
        )!
        await expect(input.value).toBe('quiet row')
        const canvas = within(canvasElement)
        // the excerpt is re-windowed to start near the match (see LongExcerptKeepsTheMatch)
        await expect(canvas.getByText('…be one quiet row…')).not.toBeNull()
        await expect(canvas.getByText('3 matches')).not.toBeNull()
        // options sit inside a named group, not loose beside the group label
        const group = canvasElement.querySelector('[role="group"]')!
        await expect(group.querySelectorAll('[role="option"]').length).toBe(3)
    },
}

/** A hit's excerpt sits on ONE ellipsised line, and core centers it on the match — so the matching
 *  term is the part a plain ellipsis cuts. The row re-windows the excerpt so the match is on screen:
 *  the match's own painted box ends inside the line's box. */
export const LongExcerptKeepsTheMatch: Story = {
    render: () => (
        <Frame width="440px">
            <ChatHistoryPanel
                history={makeHistory({
                    sessions: SESSIONS,
                    searchHits: HITS,
                    query: 'quiet row',
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const line = within(canvasElement).getByText(/quiet row of chips wraps/)
        const text = line.firstChild as Text
        const at = text.data.indexOf('quiet row')
        await expect(at).toBeGreaterThanOrEqual(0)
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 'quiet row'.length)
        // the line really is clipped (the premise), yet the match is not what got cut
        await expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
        await expect(range.getBoundingClientRect().right).toBeLessThanOrEqual(
            line.getBoundingClientRect().right,
        )
    },
}

export const Searching: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({
                    query: 'quiet row',
                    searchLoading: true,
                })}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('Searching…'),
        ).not.toBeNull()
    },
}

export const NoMatch: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel history={makeHistory({ query: 'zebra' })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText(
                'No conversations match that search.',
            ),
        ).not.toBeNull()
    },
}

export const Loading: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ loading: true })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('Loading…')).not.toBeNull()
    },
}

export const Empty: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ sessions: [] })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('No past conversations yet.'),
        ).not.toBeNull()
    },
}

export const EmptyDaemon: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ sessions: [], scope: 'daemon' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('No daemon conversations yet.'),
        ).not.toBeNull()
    },
}

export const EmptyAll: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel
                history={makeHistory({ sessions: [], scope: 'all' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('No conversations yet.'),
        ).not.toBeNull()
    },
}

/** No `onNewChat` — the header carries only the scope and close. */
export const WithoutNewChat: Story = {
    render: () => (
        <Frame>
            <ChatHistoryPanel history={makeHistory({ sessions: SESSIONS })} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByText('new chat')).toBeNull()
    },
}

/** A column-mode host: the scope + new chat drop to a line of their own under the prompt. */
export const Narrow: Story = {
    render: () => (
        <Frame width="300px">
            <ChatHistoryPanel
                history={makeHistory({ sessions: SESSIONS, scope: 'all' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        // The scope must sit on its own line below the prompt, not squeeze the input beside it.
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="conversations"]',
        )!
        const you = within(canvasElement).getByText(/you/)
        await expect(
            you.getBoundingClientRect().top -
                input.getBoundingClientRect().bottom,
        ).toBeGreaterThan(0)
        await expect(input.getBoundingClientRect().width).toBeGreaterThan(160)
    },
}

/** Wide pane: the rows sit in a centred 720px reading column, header aligned to it. */
export const Wide: Story = {
    render: () => (
        <Frame width="1100px">
            <ChatHistoryPanel
                history={makeHistory({ sessions: SESSIONS, scope: 'all' })}
                onNewChat={() => {}}
            />
        </Frame>
    ),
}
