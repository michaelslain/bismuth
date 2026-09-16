// Visual spec for <ChatHistoryPanel> — the session-history popover body, driven from a plain
// `ChatHistoryState` built per-story (no ChatSession needed; the panel only ever reads this slice).
import { createSignal } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
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

const SESSIONS: ChatSessionInfo[] = [
    {
        sessionId: 's1',
        summary: 'Restyle the daemon page',
        lastModified: Date.now() - 5 * 60_000,
        origin: 'user',
    },
    {
        sessionId: 's2',
        summary: 'dream — nightly vault review',
        lastModified: Date.now() - 3 * 3_600_000,
        origin: 'daemon',
    },
]

const HITS: ChatSearchHit[] = [
    {
        sessionId: 's1',
        summary: 'Restyle the daemon page',
        lastModified: Date.now() - 5 * 60_000,
        origin: 'user',
        snippet: 'the chat controls should be one quiet row…',
        inTitle: false,
    },
]

function makeHistory(init: {
    sessions?: ChatSessionInfo[]
    searchHits?: ChatSearchHit[]
    query?: string
    loading?: boolean
}): ChatHistoryState {
    const [open, setOpen] = createSignal(true)
    const [loading] = createSignal(init.loading ?? false)
    const [sessions] = createSignal(init.sessions ?? [])
    const [scope, setScope] = createSignal<ChatScope>('user')
    const [query, setQuery] = createSignal(init.query ?? '')
    const [searchHits] = createSignal(init.searchHits ?? [])
    const [searchLoading] = createSignal(false)
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

export const List: Story = {
    render: () => (
        <div style={{ width: '520px', height: '640px' }}>
            <ChatHistoryPanel
                history={makeHistory({ sessions: SESSIONS })}
                onNewChat={() => {}}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('Restyle the daemon page')).not.toBeNull()
        await expect(canvas.getByText('NEW CHAT')).not.toBeNull()
    },
}

export const Search: Story = {
    render: () => (
        <div style={{ width: '520px', height: '640px' }}>
            <ChatHistoryPanel
                history={makeHistory({
                    sessions: SESSIONS,
                    searchHits: HITS,
                    query: 'quiet row',
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const input = canvasElement.querySelector<HTMLInputElement>(
            'input[placeholder="Search conversations…"]',
        )!
        await expect(input.value).toBe('quiet row')
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('the chat controls should be one quiet row…'),
        ).not.toBeNull()
    },
}

export const Empty: Story = {
    render: () => (
        <div style={{ width: '520px', height: '260px' }}>
            <ChatHistoryPanel history={makeHistory({ sessions: [] })} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(
            canvas.getByText('No past conversations yet.'),
        ).not.toBeNull()
    },
}
