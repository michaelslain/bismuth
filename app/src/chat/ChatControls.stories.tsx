// Visual spec for <ChatControls> — the quiet inline controls row for a host with no ViewBar (the
// daemon page). `chatControlSlots()` (ChatHeader's ViewBar-region shape) is exercised indirectly by
// ChatHeader.stories.tsx, which renders through the real bar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import ChatControls from './ChatControls'
import { makeStubChatSession } from './_stubChatSession'
import type { ChatManifest } from '../../../core/src/chat'
import styles from './ChatControls.module.css'

const meta = {
    title: 'Chat/ChatControls',
    component: ChatControls,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof ChatControls>

export default meta
type Story = StoryObj<typeof meta>

/** A `data-row-drop`/`data-bar-drop` tagged control stays IN THE DOM at every tier — the ladder
 *  only sets `display: none` — so `querySelector(...).toBeNull()` can never see a drop. This is
 *  the same idiom ChatHeader.stories.tsx's `shown()` uses for its own ladder. */
const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

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

/** No session yet: the interface says "renders the row disabled at the SAME height" — rendered
 *  here side by side with an armed row at the same width so the play() can prove the height
 *  claim directly rather than assuming it from the markup. */
export const NoSession: Story = {
    render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '24px' }}>
            <ChatControls
                session={makeStubChatSession({
                    manifest: MANIFEST,
                    models: MODELS,
                    displayModel: 'opus',
                    displayModelValue: 'opus',
                    permMode: 'bypassPermissions',
                })}
            />
            <ChatControls session={undefined} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const rows = canvasElement.querySelectorAll<HTMLElement>(
            `.${styles.row}`,
        )
        expect(rows.length).toBe(2)
        const [armed, noSession] = Array.from(rows)
        // The disabled row renders the REAL controls (DISABLED_SESSION), not a "···" stand-in — so
        // "New chat" is present in both, just inert in the second.
        const newChats = canvasElement.querySelectorAll(
            '[data-testid="chat-new"]',
        )
        expect(newChats.length).toBe(2)
        expect(getComputedStyle(noSession).pointerEvents).toBe('none')
        // THE ASSERTION THIS FIX EXISTS FOR: arming the daemon's chat must not move the composer
        // sitting above this row, which it would if the no-session row were a different height
        // than the armed one it's about to become.
        expect(noSession.getBoundingClientRect().height).toBe(
            armed.getBoundingClientRect().height,
        )
    },
}

/** A daemon centre column at its narrowest (~360px — the low end of the ~300–400px range that
 *  column can shrink to). The row must stay ONE line at this width — a second line would grow
 *  taller than the no-session row beside it and shift the composer, exactly the failure the height
 *  parity above exists to prevent — so lower-priority controls (provider, then --chrome) drop
 *  instead of wrapping. */
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
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        // ONE LINE — a wrapped row would report a taller box than --h-control (24px); 2px of
        // slack covers sub-pixel layout rounding without letting a real second line pass.
        expect(row.getBoundingClientRect().height).toBeLessThan(26)
        // The provider Select (this row's widest control, data-row-drop="1") is what makes room —
        // hidden at this width (still in the DOM, per the ladder's `display: none`, hence `shown`
        // rather than `toBeNull`), while the model, permission mode and New chat all survive.
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-provider"]')),
        ).toBe(false)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-perm-mode"]')),
        ).toBe(true)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-model"]')),
        ).toBe(true)
    },
}
