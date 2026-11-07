// Visual spec for <ChatReadouts> — the chat header's trailing readout: the context meter, plus an
// `N mcp servers down` warning that exists only while a configured server is not connected. Each
// story is one state; ChatHeader.stories.tsx shows the same component through the real bar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { expect, userEvent, waitFor } from 'storybook/test'
import ChatReadouts from './ChatReadouts'
import { resetHiddenMcpServers } from './mcpWarningHidden'
import { settings, setSettings } from '../settings'
import { makeStubChatSession, type StubChatSessionInit } from './_stubChatSession'
import type { ChatManifest } from '../../../core/src/chat'
import { Row } from '../ui/_storyKit'

const meta = {
    title: 'Chat/ChatReadouts',
    component: ChatReadouts,
    parameters: { layout: 'centered' },
    // `hide` and `never show again` write window-wide state; every story starts with neither.
    decorators: [
        Story => {
            resetHiddenMcpServers()
            setSettings('chat', 'mutedMcpServers', [])
            return <Story />
        },
    ],
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

const privateText = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="chat-private"]')?.textContent ?? ''

/** The private toggle on before the first manifest: `private` alone. */
export const PrivateOpening: Story = {
    render: () => <Readouts init={{ isPrivate: true }} />,
    play: async ({ canvasElement }) => {
        expect(privateText(canvasElement)).toBe('private')
        expect(canvasElement.textContent).toBe('private')
    },
}

/** The private toggle on mid-conversation: `private // context [###.......] 34%`. */
export const PrivateWithContext: Story = {
    render: () => (
        <Readouts
            init={{ isPrivate: true, manifest: MANIFEST, context: context(34), mcpConnected: 3 }}
        />
    ),
    play: async ({ canvasElement }) => {
        expect(privateText(canvasElement)).toBe('private')
        expect(meterText(canvasElement)).toBe('context  [###.......] 34%')
        // The run's spacing is flex gap, not text: `//` sits between the two with no spaces.
        expect(canvasElement.textContent).toContain('private//context')
    },
}

const mcpButton = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="chat-mcp"]')
const panel = () => document.querySelector<HTMLElement>('[data-testid="mcp-down-panel"]')
const panelButton = (label: string) =>
    [...(panel()?.querySelectorAll('button') ?? [])].find(b => b.textContent === label)!

/** Pressing the warning opens the panel: each down server with its status, then `[hide]` and
 *  `[never show again]`. */
export const McpPanelOpen: Story = {
    render: () => (
        <Readouts init={{ manifest: MANIFEST, context: context(34), mcpConnected: 1 }} />
    ),
    play: async ({ canvasElement }) => {
        await userEvent.click(mcpButton(canvasElement)!)
        await waitFor(() => expect(panel()).not.toBeNull())
        expect(panel()!.textContent).toContain('railway')
        expect(panel()!.textContent).toContain('linear')
        expect(panel()!.textContent).toContain('failed')
    },
}

/** A live session whose manifest a play() can change, to show a server going down later. */
function LiveReadouts(props: { onReady: (setServers: (n: string[]) => void) => void }) {
    const [manifest, setManifest] = createSignal<ChatManifest | null>({
        ...MANIFEST,
        mcpServers: [
            { name: 'bismuth', status: 'connected' },
            { name: 'railway', status: 'failed' },
        ],
    })
    props.onReady(down =>
        setManifest({
            ...MANIFEST,
            mcpServers: ['bismuth', 'railway', 'linear'].map(name => ({
                name,
                status: down.includes(name) ? 'failed' : 'connected',
            })),
        }),
    )
    return (
        <ChatReadouts
            session={{
                manifest,
                context: () => context(34),
                isPrivate: () => false,
            }}
        />
    )
}

let setDown: (names: string[]) => void = () => {}

/** `[hide]` silences the warning; it comes back only when a DIFFERENT server goes down. */
export const McpHideThenNewServerDown: Story = {
    render: () => <LiveReadouts onReady={f => (setDown = f)} />,
    play: async ({ canvasElement }) => {
        await userEvent.click(mcpButton(canvasElement)!)
        await waitFor(() => expect(panel()).not.toBeNull())
        await userEvent.click(panelButton('hide'))
        await waitFor(() => expect(mcpButton(canvasElement)).toBeNull())
        expect(meterText(canvasElement)).toBe('context  [###.......] 34%')
        // The same server still down: still quiet.
        setDown(['railway'])
        expect(mcpButton(canvasElement)).toBeNull()
        // A new one goes down: the warning is back, counting both.
        setDown(['railway', 'linear'])
        await waitFor(() =>
            expect(mcpButton(canvasElement)?.textContent).toBe('2 mcp servers down'),
        )
    },
}

/** `[never show again]` writes the down servers to `chat.mutedMcpServers`; a muted server no
 *  longer counts, and a new one still warns, alone. */
export const McpNeverShowAgain: Story = {
    render: () => <LiveReadouts onReady={f => (setDown = f)} />,
    play: async ({ canvasElement }) => {
        await userEvent.click(mcpButton(canvasElement)!)
        await waitFor(() => expect(panel()).not.toBeNull())
        await userEvent.click(panelButton('never show again'))
        await waitFor(() => expect(mcpButton(canvasElement)).toBeNull())
        expect([...settings.chat.mutedMcpServers]).toEqual(['railway'])
        setDown(['railway', 'linear'])
        await waitFor(() =>
            expect(mcpButton(canvasElement)?.textContent).toBe('1 mcp server down'),
        )
    },
}
