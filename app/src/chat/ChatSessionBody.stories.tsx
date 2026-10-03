// Visual spec for <ChatSessionBody> — the body ChatView (variant "pane") and DaemonChat (variant
// "column") share. Each story hosts it in the same kind of flex column its real host provides,
// over a stub session (chat/_stubChatSession.ts).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import ChatSessionBody from './ChatSessionBody'
import { makeStubChatSession } from './_stubChatSession'
import { CONVERSATION_ITEMS } from './_transcriptFixtures'
import ChatTurnColumn from './ChatTurnColumn'
import EmptyState from '../ui/EmptyState'

const meta = {
    title: 'Chat/ChatSessionBody',
    component: ChatSessionBody,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatSessionBody>

export default meta
type Story = StoryObj<typeof meta>

const noNames = () => []

/** A host column like ChatView's tab host (pane) or DaemonChat's column (column). */
function Host(props: { gap?: boolean; children: unknown }) {
    return (
        <div
            style={{
                display: 'flex',
                'flex-direction': 'column',
                height: '520px',
                width: '100%',
                'max-width': '720px',
                'box-sizing': 'border-box',
                gap: props.gap ? 'var(--sp-3)' : undefined,
                background: 'var(--bg)',
                color: 'var(--fg)',
            }}
        >
            {props.children as never}
        </div>
    )
}

const greeting = () => (
    <ChatTurnColumn>
        <EmptyState>Ask anything about your vault.</EmptyState>
    </ChatTurnColumn>
)

export const PaneConversation: Story = {
    render: () => (
        <Host>
            <ChatSessionBody
                variant="pane"
                session={makeStubChatSession({ transcript: [...CONVERSATION_ITEMS] })}
                placeholder="Message Claude"
                persona="Claude"
                empty={greeting()}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const PaneEmpty: Story = {
    render: () => (
        <Host>
            <ChatSessionBody
                variant="pane"
                session={makeStubChatSession()}
                placeholder="Message Claude"
                persona="Claude"
                empty={greeting()}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const PaneNoSession: Story = {
    render: () => (
        <Host>
            <ChatSessionBody
                variant="pane"
                session={undefined}
                placeholder="Message Claude"
                persona="Claude"
                empty={greeting()}
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const PaneHistoryOpen: Story = {
    render: () => (
        <Host>
            <ChatSessionBody
                variant="pane"
                session={makeStubChatSession({ historyOpen: true })}
                placeholder="Message Claude"
                persona="Claude"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const ColumnConversation: Story = {
    render: () => (
        <Host gap>
            <ChatSessionBody
                variant="column"
                session={makeStubChatSession({ transcript: [...CONVERSATION_ITEMS] })}
                placeholder="Message daemon"
                persona="daemon"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const ColumnResting: Story = {
    render: () => (
        <Host gap>
            <ChatSessionBody
                variant="column"
                session={undefined}
                placeholder="Message daemon"
                persona="daemon"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}

export const ColumnSetupBlocked: Story = {
    render: () => (
        <Host gap>
            <ChatSessionBody
                variant="column"
                session={makeStubChatSession({ setupError: 'opencode' })}
                placeholder="Message daemon"
                persona="daemon"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}
