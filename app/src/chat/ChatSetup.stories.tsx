// Visual spec for <ChatSetup> — the dead-end screen ChatView.tsx swaps in for the transcript when
// a chat can't run: the active provider's CLI is missing, or this vault's hidden-notes policy can't
// be honoured. See ChatSetup.tsx for why one component covers every copy variant.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatSetup from './ChatSetup'
import FreeAgentSetup from './FreeAgentSetup'
import Text from '../ui/Text'
import AgentSwitchRow from './AgentSwitchRow'

const meta = {
    title: 'Chat/ChatSetup',
    component: ChatSetup,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatSetup>

export default meta
type Story = StoryObj<typeof meta>

const frame = (children: unknown) => (
    <div style={{ height: '420px', display: 'flex' }}>{children as any}</div>
)

/** No agent is set up (an `auto` chat with nothing installed) — the neutral screen with only the
 *  free-agent download, nothing to switch to. */
export const NoAgent: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="MessageSquare"
                iconLabel="Chat"
                heading="this chat needs an agent"
                body={
                    <Text>
                        No coding agent is installed yet. Set up a free one in
                        one click.
                    </Text>
                }
                extra={
                    <FreeAgentSetup
                        progress={{ phase: 'idle' }}
                        onStart={() => {}}
                    />
                }
            />,
        ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('this chat needs an agent')
        await expect(canvasElement.textContent).toContain('No coding agent is installed yet.')
        await expect(canvasElement.textContent).toContain('set up free agent')
    },
}

/** An explicitly chosen agent isn't installed — the body names it. */
export const AgentMissing: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="MessageSquare"
                iconLabel="Chat"
                heading="this chat needs an agent"
                body={
                    <Text>
                        opencode isn't installed. Set up a free agent instead,
                        or install opencode and reopen this chat.
                    </Text>
                }
                extra={
                    <FreeAgentSetup
                        progress={{ phase: 'idle' }}
                        onStart={() => {}}
                    />
                }
            />,
        ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain("opencode isn't installed.")
    },
}

/** A visibility refusal — the backend IS installed, it just can't honour this vault's hidden
 *  notes. Distinct copy: never tells the user to install anything. */
export const VisibilityRefused: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="Lock"
                iconLabel="Visibility"
                heading="opencode can't honour this vault's hidden notes"
                body={
                    <p>
                        This vault hides some notes from AI tools, and
                        opencode has no verified mechanism to keep them out of
                        context. Switch to Claude Code, which does.
                    </p>
                }
                actionLabel="use claude code instead"
                onAction={() => {}}
            />,
        ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain("can't honour this vault's hidden notes")
        await expect(canvasElement.textContent).toContain('use claude code instead')
    },
}

/** The `extra` slot: the free-agent block, . */
export const WithExtra: Story = {
    render: () =>
        frame(
            <ChatSetup
                icon="MessageSquare"
                iconLabel="Chat"
                heading="this chat needs an agent"
                body={
                    <Text>
                        OpenAI Codex isn't installed. Switch to an agent you
                        already have, or set up a free one.
                    </Text>
                }
                extra={
                    <>
                        <AgentSwitchRow
                            backends={[
                                { id: 'claude', label: 'Claude Code' },
                                { id: 'gemini', label: 'Gemini CLI' },
                            ]}
                            onPick={() => {}}
                        />
                        <FreeAgentSetup
                            progress={{ phase: 'idle' }}
                            onStart={() => {}}
                        />
                    </>
                }
            />,
        ),
    play: async ({ canvasElement }) => {
        await expect(canvasElement.textContent).toContain('set up free agent')
        await expect(canvasElement.textContent).toContain('claude code')
    },
}
