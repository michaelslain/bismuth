// Visual spec for <ChatControls> — the quiet inline controls row for a host with no ViewBar (the
// daemon page). `chatControlSlots()` (ChatHeader's ViewBar-region shape) is exercised indirectly by
// ChatHeader.stories.tsx, which renders through the real bar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatControls from './ChatControls'
import { makeStubChatSession } from './_stubChatSession'
import type { ChatManifest } from '../../../core/src/chat'

const meta = {
    title: 'Chat/ChatControls',
    component: ChatControls,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatControls>

export default meta
type Story = StoryObj<typeof meta>

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'bypassPermissions',
    slashCommands: ['compact', 'clear'],
    tools: ['Read', 'Write', 'Bash'],
    mcpServers: [{ name: 'bismuth', status: 'connected' }],
}

const MODELS = [
    {
        value: 'opus',
        label: 'Opus 4.8',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
]

export const Row: Story = {
    render: () => (
        <ChatControls
            session={makeStubChatSession({
                manifest: MANIFEST,
                models: MODELS,
                displayModel: 'opus',
                displayModelValue: 'opus',
                permMode: 'bypassPermissions',
            })}
        />
    ),
    play: async ({ canvasElement }) => {
        // Readouts are OMITTED from the row (Acceptance) — no tool/mcp/context chips here.
        expect(canvasElement.querySelector('[data-testid="chat-tools"]')).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-perm-mode"]'),
        ).not.toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-new"]'),
        ).not.toBeNull()
    },
}

export const NoSession: Story = {
    render: () => <ChatControls session={undefined} />,
    play: async ({ canvasElement }) => {
        expect(canvasElement.querySelector('[data-testid="chat-new"]')).toBeNull()
    },
}

export const Narrow360: Story = {
    render: () => (
        <div style={{ width: '360px' }}>
            <ChatControls
                session={makeStubChatSession({
                    manifest: MANIFEST,
                    models: MODELS,
                    displayModel: 'opus',
                    displayModelValue: 'opus',
                    permMode: 'bypassPermissions',
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByLabelText('New chat')).not.toBeNull()
    },
}
