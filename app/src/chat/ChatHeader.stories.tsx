// Visual spec for <ChatHeader> — the chat tab's toolbar, now session-driven (daemon-chat plan,
// Task 3). The bar-scoped register (the transparent picker chrome, the crumb width cap) rides the
// header's own root (ChatHeader.module.css), so a story needs no host wrapper class.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatHeader from './ChatHeader'
import { makeStubChatSession } from './_stubChatSession'
import { chatOriginIcon } from '../chatOrigin'
import type { ChatManifest } from '../../../core/src/chat'

const meta = {
    title: 'Chat/ChatHeader',
    component: ChatHeader,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatHeader>

export default meta
type Story = StoryObj<typeof meta>

const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'bypassPermissions',
    slashCommands: ['compact', 'clear', 'chrome'],
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'WebFetch'],
    mcpServers: [
        { name: 'bismuth', status: 'connected' },
        { name: 'railway', status: 'connected' },
    ],
}
const MODELS = [
    {
        value: 'opus',
        label: 'Opus 4.8',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
    {
        value: 'sonnet',
        label: 'Sonnet 4.5',
        description: 'Balanced',
        effortLevels: ['low', 'medium', 'high'],
    },
]

const LONG_TITLE = 'Refactoring the collapse ladder across every view bar'

function InPane(props: { width: number; permMode?: string }) {
    const session = makeStubChatSession({
        manifest: MANIFEST,
        models: MODELS,
        displayModel: 'opus',
        displayModelValue: 'opus',
        effortOptions: [
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
        ],
        effortValue: 'high',
        context: { percentage: 42, totalTokens: 84_000, maxTokens: 200_000 },
        mcpConnected: 2,
        permMode: props.permMode ?? 'default',
    })
    return (
        <div style={{ width: `${props.width}px`, height: '120px' }}>
            <ChatHeader
                title={LONG_TITLE}
                originIcon={chatOriginIcon('user')}
                session={session}
            />
        </div>
    )
}

const paint = (root: Element, testid: string) => {
    const trigger = root.querySelector<HTMLElement>(
        `[data-testid="${testid}"] .ui-select-trigger`,
    )!
    const cs = getComputedStyle(trigger)
    return { color: cs.color, border: cs.borderTopColor }
}

/** The default (Default permission mode) shipping shape: the crumb holds a real slice of the bar
 *  and every control renders. */
export const Default: Story = {
    render: () => <InPane width={900} />,
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>('.crumb b')!
        expect(title.clientWidth).toBeGreaterThan(0)
        expect(
            canvasElement.querySelector('[data-testid="chat-perm-mode"]'),
        ).not.toBeNull()
        expect(
            canvasElement.querySelector('[data-testid="chat-new"]'),
        ).not.toBeNull()
    },
}

/** Bypass — Acceptance: "a dangerous mode (Bypass) is signalled by text tone only — no box, no
 *  border". Compared against the model picker beside it, the same element TYPE in the same bar
 *  under the same register rules, so a theme change moves both and the comparison holds. */
export const Bypass: Story = {
    render: () => <InPane width={900} permMode="bypassPermissions" />,
    play: async ({ canvasElement }) => {
        const armed = paint(canvasElement, 'chat-perm-mode')
        const plain = paint(canvasElement, 'chat-model')
        expect(armed.color).not.toBe(plain.color)
        // NO border distinction any more — text tone only.
        expect(armed.border).toBe(plain.border)
    },
}

/** The floor: a 460px pane. The bar must never clip its primary action (New chat). */
export const Narrow460: Story = {
    render: () => <InPane width={460} />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('.viewbar')!
        const newChat = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-new"]',
        )!
        expect(newChat.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right + 1,
        )
    },
}
