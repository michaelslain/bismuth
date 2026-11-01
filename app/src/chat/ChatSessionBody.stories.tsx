// Visual spec for <ChatSessionBody> — the body ChatView (variant "pane") and DaemonChat (variant
// "column") share. Each story hosts it in the same kind of flex column its real host provides,
// over a stub session (chat/_stubChatSession.ts).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
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

/** At a narrow pane width (both columns below their `--chat-column` cap, so neither centres) the
 *  composer's outlined box starts exactly where the transcript's turn text does — they share
 *  `--note-gutter`, not two literals that can drift 16px apart. */
export const PaneGutterAligned: Story = {
    render: () => (
        <div style={{ width: '560px' }}>
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
                    composerTestId="pane-composer"
                />
            </Host>
        </div>
    ),
    play: async ({ canvasElement }) => {
        const wrapper = within(canvasElement).getByTestId('pane-composer')
        const box = wrapper.firstElementChild as HTMLElement
        const turn = within(canvasElement).getAllByText('you')[0]
        const boxLeft = box.getBoundingClientRect().left
        const turnLeft = turn.getBoundingClientRect().left
        await expect(Math.abs(boxLeft - turnLeft)).toBeLessThan(1)
        // ...and that left edge IS the shared gutter, not both having drifted to zero
        const probe = document.createElement('span')
        probe.style.display = 'block'
        probe.style.width = 'var(--note-gutter)'
        canvasElement.appendChild(probe)
        const gutter = probe.getBoundingClientRect().width
        probe.remove()
        await expect(boxLeft - canvasElement.getBoundingClientRect().left).toBeGreaterThanOrEqual(gutter)
    },
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

const SUBAGENTS = [
    {
        id: 'a1',
        agentType: 'Explore',
        description: 'map the chat transcript pipeline',
        status: 'done' as const,
    },
    {
        id: 'a2',
        agentType: 'general-purpose',
        description: 'find every caller of deliver',
        status: 'running' as const,
    },
]

/** The agents strip sits directly above the composer box, edge to edge with it. `play()` flips the
 *  running row to done through the stub's setter — no timers. */
export const PaneWithSubagents: Story = {
    render: () => {
        const session = makeStubChatSession({
            transcript: [...CONVERSATION_ITEMS],
            subagents: SUBAGENTS,
        })
        return (
            <Host>
                <ChatSessionBody
                    variant="pane"
                    session={session}
                    placeholder="Message Claude"
                    persona="Claude"
                    empty={greeting()}
                    noteNames={noNames}
                    memoryNames={noNames}
                    tagNames={noNames}
                    composerTestId="pane-composer"
                />
            </Host>
        )
    },
    play: async ({ canvasElement }) => {
        const c = within(canvasElement)
        await expect(c.getByText('find every caller of deliver')).toBeTruthy()
        const strip = c.getByRole('status')
        const box = c.getByTestId('pane-composer').lastElementChild as HTMLElement
        await expect(
            Math.abs(
                strip.getBoundingClientRect().left -
                    box.getBoundingClientRect().left,
            ),
        ).toBeLessThan(1)
    },
}

export const ColumnWithSubagents: Story = {
    render: () => (
        <Host gap>
            <ChatSessionBody
                variant="column"
                session={makeStubChatSession({
                    transcript: [...CONVERSATION_ITEMS],
                    subagents: SUBAGENTS,
                })}
                placeholder="Message daemon"
                persona="daemon"
                noteNames={noNames}
                memoryNames={noNames}
                tagNames={noNames}
            />
        </Host>
    ),
}
