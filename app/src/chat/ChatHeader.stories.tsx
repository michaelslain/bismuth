// Visual spec for <ChatHeader> — the chat tab's toolbar, now IDENTITY + READOUTS ONLY
// (final-findings Group 2 #5): the provider/model/effort/permission pickers and the auth/history/
// new-chat actions moved to the quiet <ChatControls session/> row under the composer, exercised by
// ChatControls.stories.tsx instead. The crumb width cap rides the header's own root
// (ChatHeader.module.css), so a story needs no host wrapper class.
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

/** The shipping shape: the crumb holds a real slice of the bar, and the readouts (tools/MCP/
 *  context) are the ONLY trailing content — Config (provider/model/effort/permission) and Actions
 *  (auth/history/new chat) are GONE from the header (final-findings Group 2 #5: they used to make
 *  this a dense strip of 8+ controls with an amber `Bypass` picker as the loudest thing on the
 *  surface). Those controls still exist, just one level down — ChatControls.stories.tsx exercises
 *  them as the quiet row a `ChatComposerBar` renders under itself. */
export const Default: Story = {
    render: () => <InPane width={900} />,
    play: async ({ canvasElement }) => {
        const title = canvasElement.querySelector<HTMLElement>('[data-testid="crumb-title"]')!
        expect(title.clientWidth).toBeGreaterThan(0)
        expect(
            canvasElement.querySelector('[data-testid="chat-tools"]'),
        ).not.toBeNull()
        expect(
            canvasElement.querySelector('[data-testid="chat-context"]'),
        ).not.toBeNull()
        // THE REGRESSION THIS STORY GUARDS: none of Config/Actions' testids may reappear in the
        // header — if one does, something started spreading `config`/`actions` back onto the bar.
        for (const testid of [
            'chat-provider',
            'chat-model',
            'chat-effort',
            'chat-perm-mode',
            'chat-history',
            'chat-new',
        ]) {
            expect(
                canvasElement.querySelector(`[data-testid="${testid}"]`),
            ).toBeNull()
        }
    },
}

/** A dangerous permission mode no longer paints anything in the header at all — Bypass's amber tint
 *  now lives on the quiet row (ChatControls.stories.tsx's Row story), not here. This story proves
 *  the negative: an armed session's header renders IDENTICALLY to a default one, since the header
 *  no longer reads `permMode` for anything. */
export const Bypass: Story = {
    render: () => <InPane width={900} permMode="bypassPermissions" />,
    play: async ({ canvasElement }) => {
        expect(
            canvasElement.querySelector('[data-testid="chat-perm-mode"]'),
        ).toBeNull()
        expect(canvasElement.querySelector('[data-testid="crumb-title"]')).not.toBeNull()
    },
}

/** The floor: a 460px pane. With Config/Actions gone, the only thing left to protect is the title
 *  crumb and the readouts — neither may overflow the bar. */
export const Narrow460: Story = {
    render: () => <InPane width={460} />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const readouts = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-context"]',
        )!
        expect(readouts.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right + 1,
        )
    },
}
