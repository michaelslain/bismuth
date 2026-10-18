// Visual spec for <ChatHistoryPanel> — the session-history pane body, driven from a plain
// `ChatHistoryState` built per-story (no ChatSession needed; the panel only ever reads this slice).
// Fixture times are anchored to local calendar days (not "now minus N hours"), so the age groups a
// story shows hold at any hour — "now minus 26h" is two calendar days back at 1am.
import { createSignal, Show } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import ChatHistoryPanel from './ChatHistoryPanel'
import type { ChatHistoryState } from './chatSession'
import type {
    ChatScope,
    ChatSearchHit,
    ChatSessionInfo,
    ChatVisibility,
} from '../api'
import { createFakeHistoryData, inScope } from './_chatHistoryState'
import Text from '../ui/Text'
import { TextButton } from '../ui/TextButton'
import { ToastHost, toasts, dismissToast } from '../ui/ToastHost'

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
    defaultVisibility?: ChatVisibility
    /** What the app does on a resume: bind the chat and close the dialog. */
    onResume?: (sessionId: string) => void
}): ChatHistoryState {
    const [open, setOpen] = createSignal(true)
    const [loading] = createSignal(init.loading ?? false)
    // Real local state behind the visibility + delete writes (see _chatHistoryState.ts): a pick
    // changes the badges, a delete removes rows, with no timer anywhere.
    const data = createFakeHistoryData({
        sessions: init.sessions ?? [],
        defaultVisibility: init.defaultVisibility,
    })
    const [scope, setScope] = createSignal<ChatScope>(init.scope ?? 'user')
    const [query, setQuery] = createSignal(init.query ?? '')
    const [searchHits] = createSignal(init.searchHits ?? [])
    const [searchLoading] = createSignal(init.searchLoading ?? false)
    return {
        ...data,
        open,
        loading,
        // The server answers each scope with its own rows; the you / daemon / all toggle filters here.
        sessions: () => data.rows().filter(s => inScope(s, scope())),
        scope,
        query,
        searchHits,
        searchLoading,
        toggle: () => setOpen(v => !v),
        close: () => setOpen(false),
        setScope,
        setQuery,
        resume: async sessionId => {
            init.onResume?.(sessionId)
            setOpen(false)
        },
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

/** The panel's history is built ONCE per story. `history={makeHistory(...)}` written inline is a
 *  reactive getter in Solid — every read would build a fresh state and silently discard a delete or
 *  a visibility pick — so each story hands its seed to this host instead. */
const Host = (p: {
    init: Parameters<typeof makeHistory>[0]
    width?: string
    newChat?: boolean
}) => {
    // What the app shows once the dialog closes: the chat it resumed or started. The panel itself
    // never hides, so without this a resume, new chat or Escape would look like it did nothing.
    const [outcome, setOutcome] = createSignal('')
    const history = makeHistory({
        ...p.init,
        onResume: id =>
            setOutcome(
                `resumed: ${p.init.sessions?.find(s => s.sessionId === id)?.summary ?? id}`,
            ),
    })
    const newChat = () => {
        setOutcome('started a new chat')
        history.close()
    }
    return (
        <Frame width={p.width}>
            <Show
                when={history.open()}
                fallback={
                    <div data-story-closed>
                        <Text tone="faint">
                            {outcome() || 'history closed'}
                        </Text>
                        <TextButton
                            onClick={() => {
                                setOutcome('')
                                history.toggle()
                            }}
                        >
                            history
                        </TextButton>
                    </div>
                }
            >
                <ChatHistoryPanel
                    {...{ history }}
                    onNewChat={p.newChat === false ? undefined : newChat}
                />
            </Show>
            {/* The app's toast host: a delete's undo toast shows here as it does in the app. */}
            <ToastHost />
        </Frame>
    )
}

export const List: Story = {
    render: () => (
        <Host init={{ sessions: SESSIONS, scope: 'all' }} />
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
        <Host init={{ sessions: SESSIONS, scope: 'all' }} />
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
        <Host init={{
                    sessions: SESSIONS,
                    searchHits: HITS,
                    query: 'quiet row',
                }} />
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
        <Host width="440px" init={{
                    sessions: SESSIONS,
                    searchHits: HITS,
                    query: 'quiet row',
                }} newChat={false} />
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
        <Host init={{
                    query: 'quiet row',
                    searchLoading: true,
                }} newChat={false} />
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('Searching…'),
        ).not.toBeNull()
    },
}

export const NoMatch: Story = {
    render: () => (
        <Host init={{ query: 'zebra' }} newChat={false} />
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
        <Host init={{ loading: true }} />
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).getByText('Loading…')).not.toBeNull()
    },
}

export const Empty: Story = {
    render: () => (
        <Host init={{ sessions: [] }} />
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
        <Host init={{ sessions: [], scope: 'daemon' }} />
    ),
    play: async ({ canvasElement }) => {
        await expect(
            within(canvasElement).getByText('No daemon conversations yet.'),
        ).not.toBeNull()
    },
}

export const EmptyAll: Story = {
    render: () => (
        <Host init={{ sessions: [], scope: 'all' }} />
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
        <Host init={{ sessions: SESSIONS }} newChat={false} />
    ),
    play: async ({ canvasElement }) => {
        await expect(within(canvasElement).queryByText('new chat')).toBeNull()
    },
}

/** A column-mode host: the scope + new chat drop to a line of their own under the prompt. */
export const Narrow: Story = {
    render: () => (
        <Host width="300px" init={{ sessions: SESSIONS, scope: 'all' }} />
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
        <Host width="1100px" init={{ sessions: SESSIONS, scope: 'all' }} />
    ),
}

// ── Visibility + delete ──────────────────────────────────────────────────────────────────────

/** Chats with their own levels: s3 hidden, s4 chat-only, the rest inherit the (open) default. */
const RESTRICTED: ChatSessionInfo[] = SESSIONS.map(s =>
    s.sessionId === 's3'
        ? { ...s, ownVisibility: 'hidden' as const }
        : s.sessionId === 's4'
          ? { ...s, ownVisibility: 'chat-only' as const }
          : s,
)

const rowOf = (root: HTMLElement, text: string) =>
    within(root).getByText(text).closest('[role="option"]') as HTMLElement

export const RestrictedChats: Story = {
    render: () => (
        <Host init={{ sessions: RESTRICTED, scope: 'all' }} />
    ),
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelectorAll('[title^="Hidden from"]').length,
        ).toBe(1)
        await expect(
            canvasElement.querySelectorAll('[title^="Chat only"]').length,
        ).toBe(1)
    },
}

/** "Hide all" set the default to hidden; s1 was exposed on its own with an explicit `all`. */
export const DefaultHidden: Story = {
    render: () => (
        <Host init={{
                    sessions: SESSIONS.map(s =>
                        s.sessionId === 's1'
                            ? { ...s, ownVisibility: 'all' as const }
                            : s,
                    ),
                    scope: 'all',
                    defaultVisibility: 'hidden',
                }} />
    ),
    play: async ({ canvasElement }) => {
        // six inherit the hidden default, the one exposed chat carries no badge
        await expect(
            canvasElement.querySelectorAll('[title^="Hidden from"]').length,
        ).toBe(6)
        await expect(
            rowOf(canvasElement, 'Restyle the daemon page').querySelector(
                '[title^="Hidden from"]',
            ),
        ).toBeNull()
    },
}

/** Right-click opens the row menu; Visibility flies out the three levels, a Check on the chat's own. */
export const RowMenu: Story = {
    render: () => (
        <Host init={{ sessions: RESTRICTED, scope: 'all' }} />
    ),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await userEvent.pointer({
            keys: '[MouseRight]',
            target: rowOf(canvasElement, 'vault-review — orphaned notes'),
        })
        await userEvent.hover(await body.findByText('Visibility'))
        await expect(await body.findByText('Chat only')).not.toBeNull()
        await expect(body.getByText('Hidden from both')).not.toBeNull()
        await expect(body.getByText('Delete chat')).not.toBeNull()
    },
}

/** Under a restricting default, a chat with no level of its own says why it is hidden; picking
 *  "Visible" writes an explicit `all`, so the badge goes away. */
export const RowMenuInherited: Story = {
    render: () => (
        <Host init={{
                    sessions: SESSIONS,
                    scope: 'all',
                    defaultVisibility: 'hidden',
                }} />
    ),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        const row = rowOf(canvasElement, 'Restyle the daemon page')
        await userEvent.pointer({ keys: '[MouseRight]', target: row })
        await userEvent.hover(await body.findByText('Visibility'))
        await expect(
            await body.findByText(
                'Effective: Hidden — inherited from the chat default',
            ),
        ).not.toBeNull()
        await userEvent.click(body.getByText('Visible to Daemon + Chat'))
        // the list re-renders from the new state, so the row is looked up again, not the old node
        await waitFor(() =>
            expect(
                rowOf(canvasElement, 'Restyle the daemon page').querySelector(
                    '[title^="Hidden from"]',
                ),
            ).toBeNull(),
        )
    },
}

/** The header menu: the default level (Check on the current one) and the scope-wide delete. */
export const ManageMenu: Story = {
    render: () => (
        <Host init={{
                    sessions: RESTRICTED,
                    scope: 'daemon',
                    defaultVisibility: 'chat-only',
                }} />
    ),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await userEvent.click(
            within(canvasElement).getByRole('button', { name: 'Manage chats' }),
        )
        await userEvent.hover(await body.findByText('Default for all chats'))
        await expect(await body.findByText('Hidden from both')).not.toBeNull()
        await expect(body.getByText('Delete all daemon chats')).not.toBeNull()
    },
}



/** Backspace while typing in the prompt edits the query: it never reaches the delete chord. */
export const BackspaceWhileTypingKeepsChats: Story = {
    render: () => (
        <Host init={{ sessions: SESSIONS, scope: 'all' }} />
    ),
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="conversations"]',
        )!
        input.focus()
        await userEvent.keyboard('abc{Backspace}')
        await expect(input.value).toBe('ab')
        // Emptying the query with Backspace never reaches a row either: every chat is still there.
        await userEvent.keyboard('{Backspace}{Backspace}')
        await expect(input.value).toBe('')
        await waitFor(() =>
            expect(
                within(canvasElement).getAllByRole('button', { name: 'delete chat' }).length,
            ).toBe(SESSIONS.length),
        )
    },
}


/** The header menu with nothing to delete: the scope-wide delete is disabled. */
export const ManageMenuEmpty: Story = {
    render: () => (
        <Host init={{ sessions: [], scope: 'daemon' }} />
    ),
    play: async ({ canvasElement }) => {
        const body = within(document.body)
        await userEvent.click(
            within(canvasElement).getByRole('button', { name: 'Manage chats' }),
        )
        const del = await body.findByText('Delete all daemon chats')
        await expect(
            del.closest('.bismuth-popover-row--disabled'),
        ).not.toBeNull()
    },
}


/** `new chat` closes the dialog the way the app does (a fresh conversation in the tab), and the
 *  host's `history` button opens it again. */
export const NewChatClosesHistory: Story = {
    render: () => <Host init={{ sessions: SESSIONS, scope: 'all' }} />,
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByRole('button', { name: /new chat/ }))
        await expect(canvas.getByText('started a new chat')).not.toBeNull()
        await userEvent.click(canvas.getByRole('button', { name: /history/ }))
        await expect(canvas.getByText('Restyle the daemon page')).not.toBeNull()
    },
}


/** Clear toasts a previous story left, so each play reads only its own. */
const clearToasts = () => {
    for (const t of toasts()) dismissToast(t.id)
}

/** A row's hover `[x]` deletes the chat at once and offers `undo`, which puts it back. */
export const RowXDeletesWithUndo: Story = {
    render: () => <Host init={{ sessions: SESSIONS, scope: 'all' }} />,
    play: async ({ canvasElement }) => {
        clearToasts()
        const canvas = within(canvasElement)
        const body = within(document.body)
        // A synthetic pointer cannot raise CSS :hover, so the hover-revealed `[x]` (pointer-events
        // none until then) is clicked past that check; real hover is covered by the browser run.
        await userEvent.click(canvas.getAllByRole('button', { name: 'delete chat' })[0], { pointerEventsCheck: 0 })
        await waitFor(() =>
            expect(canvas.queryByText('Restyle the daemon page')).toBeNull(),
        )
        await expect(body.getByText('deleted chat: Restyle the daemon page')).not.toBeNull()
        await userEvent.click(body.getByRole('button', { name: /undo/ }))
        await waitFor(() =>
            expect(canvas.getByText('Restyle the daemon page')).not.toBeNull(),
        )
        clearToasts()
    },
}

/** Delete on the arrow-key cursor row deletes it at once, with the same undo. */
export const DeleteKeyDeletesWithUndo: Story = {
    render: () => <Host init={{ sessions: SESSIONS, scope: 'all' }} />,
    play: async ({ canvasElement }) => {
        clearToasts()
        const canvas = within(canvasElement)
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="conversations"]',
        )!
        input.focus()
        await userEvent.keyboard('{ArrowDown}{Delete}')
        await waitFor(() =>
            expect(canvas.queryByText('Restyle the daemon page')).toBeNull(),
        )
        await expect(canvas.getByText('dream — nightly vault review')).not.toBeNull()
        await expect(
            within(document.body).getByText('deleted chat: Restyle the daemon page'),
        ).not.toBeNull()
        clearToasts()
    },
}

/** Delete all removes every chat in the scope at once; `undo` brings them all back. */
export const DeleteAllWithUndo: Story = {
    render: () => <Host init={{ sessions: SESSIONS, scope: 'all' }} />,
    play: async ({ canvasElement }) => {
        clearToasts()
        const canvas = within(canvasElement)
        const body = within(document.body)
        await userEvent.click(canvas.getByRole('button', { name: 'Manage chats' }))
        await userEvent.click(await body.findByText('Delete every chat'))
        await waitFor(() =>
            expect(canvas.getByText('No conversations yet.')).not.toBeNull(),
        )
        await expect(body.getByText(`deleted ${SESSIONS.length} chats`)).not.toBeNull()
        await userEvent.click(body.getByRole('button', { name: /undo/ }))
        await waitFor(() =>
            expect(canvas.getAllByRole('button', { name: 'delete chat' }).length).toBe(
                SESSIONS.length,
            ),
        )
        clearToasts()
    },
}
