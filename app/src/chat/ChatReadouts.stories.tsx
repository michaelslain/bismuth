// Visual spec for <ChatReadouts> — the chat header's trailing readout: the context meter, plus an
// `N mcp servers down` warning that exists only while a configured server is not connected. Each
// story is one state; ChatHeader.stories.tsx shows the same component through the real bar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatReadouts from './ChatReadouts'
import { makeStubChatSession, type StubChatSessionInit } from './_stubChatSession'
import type { ChatManifest } from '../../../core/src/chat'
import { Row } from '../ui/_storyKit'

const meta = {
    title: 'Chat/ChatReadouts',
    component: ChatReadouts,
    parameters: { layout: 'centered' },
} satisfies Meta<typeof ChatReadouts>

export default meta
type Story = StoryObj<typeof meta>

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'default',
    slashCommands: ['compact', 'clear'],
    tools: ['Read', 'Write', 'Edit', 'Bash'],
    mcpServers: [
        { name: 'bismuth', status: 'connected' },
        { name: 'railway', status: 'connected' },
        { name: 'linear', status: 'connected' },
    ],
}

const context = (percentage: number) => ({
    percentage,
    totalTokens: Math.round(percentage * 2000),
    maxTokens: 200_000,
})

function Readouts(props: { init: StubChatSessionInit }) {
    return <ChatReadouts session={makeStubChatSession(props.init)} />
}

const meterText = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="chat-context"]')?.textContent ?? ''

/** The everyday state: a third of the context used, every MCP server connected — the corner is
 *  only the meter. */
export const ContextLow: Story = {
    render: () => (
        <Readouts init={{ manifest: MANIFEST, context: context(34), mcpConnected: 3 }} />
    ),
    play: async ({ canvasElement }) => {
        expect(meterText(canvasElement)).toBe('context  [###.......] 34%')
        expect(canvasElement.querySelector('[data-testid="chat-mcp"]')).toBeNull()
    },
}

/** Past 80% the fill turns `--danger`: compaction is close. */
export const ContextHigh: Story = {
    render: () => (
        <Readouts init={{ manifest: MANIFEST, context: context(86), mcpConnected: 3 }} />
    ),
    play: async ({ canvasElement }) => {
        expect(meterText(canvasElement)).toBe('context  [#########.] 86%')
    },
}

/** Two of three servers failed: the warning leads, separated from the meter by `//`. */
export const McpServersDown: Story = {
    render: () => (
        <Readouts init={{ manifest: MANIFEST, context: context(34), mcpConnected: 1 }} />
    ),
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector('[data-testid="chat-mcp"]')?.textContent,
        ).toBe('2 mcp servers down')
    },
}

/** One server down — singular wording. */
export const McpServerDown: Story = {
    render: () => (
        <Readouts init={{ manifest: MANIFEST, context: context(52), mcpConnected: 2 }} />
    ),
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector('[data-testid="chat-mcp"]')?.textContent,
        ).toBe('1 mcp server down')
    },
}

/** Manifest in, no context frame yet (before the first turn completes): a down server still
 *  shows, alone, with no dangling separator. */
export const McpDownNoContext: Story = {
    render: () => <Readouts init={{ manifest: MANIFEST, context: null, mcpConnected: 2 }} />,
    play: async ({ canvasElement }) => {
        expect(canvasElement.textContent).toBe('1 mcp server down')
    },
}

/** Before the first manifest arrives there is nothing sensible to show: renders nothing. The
 *  caption is the story's own, so the frame is not mistaken for a blank render. */
export const NoManifest: Story = {
    render: () => (
        <Row label="no manifest yet — the readout renders nothing">
            <Readouts init={{ manifest: null, context: context(34) }} />
        </Row>
    ),
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[data-testid="chat-context"]')).toBeNull()
    },
}
