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

// The row's own reasoning-effort options — a SEPARATE list from each model's `effortLevels` above
// (ChatSession.effortOptions is session-scoped, not per-model).
const EFFORT_OPTIONS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
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
                effortOptions: EFFORT_OPTIONS,
                effortValue: 'medium',
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
        // Provider/model/effort no longer render as separate controls — they're folded behind the
        // model word (ChatModelMenu). One control, not three.
        expect(canvasElement.querySelector('[data-testid="chat-provider"]')).toBeNull()
        expect(canvasElement.querySelector('[data-testid="chat-effort"]')).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-model"]'),
        ).not.toBeNull()
        // Bypass's tone — Acceptance: "a dangerous mode (Bypass) is signalled by text tone only —
        // no box, no border" — compared against the model control beside it: same element
        // register under the same `.row`, so a theme change moves both and the comparison holds.
        const paint = (testid: string) => {
            const trigger = canvasElement.querySelector<HTMLElement>(
                `[data-testid="${testid}"] [data-select-trigger]`,
            )!
            const cs = getComputedStyle(trigger)
            return { color: cs.color, border: cs.borderTopColor }
        }
        const armed = paint('chat-perm-mode')
        // The model control is a plain text Button, not a Select — read its own computed color
        // instead of reaching for `.ui-select-trigger`, which it has none of.
        const modelWord = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-model"] button, [data-testid="chat-model"] span',
        )!
        const plainColor = getComputedStyle(modelWord).color
        expect(armed.color).not.toBe(plainColor)
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
                    effortOptions: EFFORT_OPTIONS,
                    effortValue: 'medium',
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
        // The disabled row renders the REAL controls (buildDisabledSession()), not a "···"
        // stand-in — so "new chat" is present in both, just inert in the second.
        const newChats = canvasElement.querySelectorAll(
            '[data-testid="chat-new"]',
        )
        expect(newChats.length).toBe(2)
        // `inert`, not `pointer-events: none` (final-findings Group 2 #2) — a keyboard user must
        // not be able to Tab into a picker that does nothing either.
        expect(noSession.inert).toBe(true)
        expect(armed.inert).toBe(false)
        // THE ASSERTION THIS FIX EXISTS FOR: arming the daemon's chat must not move the composer
        // sitting above this row, which it would if the no-session row were a different height
        // than the armed one it's about to become.
        expect(noSession.getBoundingClientRect().height).toBe(
            armed.getBoundingClientRect().height,
        )
    },
}

/** Width samples proving the row can never overflow its own box — there is no longer a
 *  narrow-width ladder that drops controls at measured breakpoints (Task 2: "no pixel ladder").
 *  Instead the model control is the ONE thing that shrinks (flex-shrink + ellipsis in
 *  ChatControls.module.css); permission mode, history and new chat always keep their full width.
 *  `scrollWidth <= clientWidth` is what actually proves "nothing spills past the container" — a
 *  row wider than its own box grows `scrollWidth` past `clientWidth` while `clientWidth` (and any
 *  height-based assertion) stays exactly the same. */
const overflowProof = (widthPx: number) => ({
    render: () => (
        <div style={{ width: `${widthPx}px` }}>
            <ChatControls
                session={makeStubChatSession({
                    manifest: MANIFEST,
                    models: MODELS,
                    displayModel: 'opus',
                    displayModelValue: 'opus',
                    permMode: 'bypassPermissions',
                    effortOptions: EFFORT_OPTIONS,
                    effortValue: 'medium',
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('new chat')).not.toBeNull()
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
        // NEVER DROPPED, even at this width: the model control, permission mode and new chat all
        // survive — the model control merely shrinks (its trigger keeps rendering client rects).
        const model = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-model"]',
        )!
        expect(model.getClientRects().length).toBeGreaterThan(0)
        expect(
            canvasElement.querySelector('[data-testid="chat-perm-mode"]')!.getClientRects()
                .length,
        ).toBeGreaterThan(0)
    },
})

/** A daemon centre column at its narrowest (~360px — the low end of the ~300–400px range that
 *  column can shrink to). The row must stay ONE line at this width — a second line would grow
 *  taller than the no-session row beside it and shift the composer. */
export const Narrow360: Story = overflowProof(360)

/** The daemon centre column's absolute floor (~260px). With only four items in the row (the model
 *  control, permission mode, history, new chat) and the model control free to shrink, the row must
 *  still fit on one line even here. */
export const Narrow260: Story = overflowProof(260)

/** THE REAL GATE for Acceptance line 4 ("no pixel ladder" / the row can never overflow): a 240px
 *  container — narrower than either width sample above — with a DELIBERATELY LONG model label, the
 *  exact case the old ladder could never have covered (it dropped whole controls at measured
 *  breakpoints, never shortened one). The model control's own `flex-shrink: 1` +
 *  `text-overflow: ellipsis` (ChatControls.module.css) has to be the thing that makes room here —
 *  nothing else in the row is a candidate. */
const LONG_MODELS = [
    {
        value: 'opus',
        label: 'Claude Opus 4.8 (1M context window)',
        description: 'Most capable',
        effortLevels: ['low', 'medium', 'high'],
    },
]

export const Overflow240: Story = {
    render: () => (
        <div style={{ width: '240px' }}>
            <ChatControls
                session={makeStubChatSession({
                    manifest: MANIFEST,
                    models: LONG_MODELS,
                    displayModel: 'opus',
                    displayModelValue: 'opus',
                    permMode: 'bypassPermissions',
                    effortOptions: EFFORT_OPTIONS,
                    effortValue: 'medium',
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
        // The permission-mode control ("Bypass") must still be fully present and rendering — the
        // one control this row NEVER drops, even under a model label long enough to need
        // truncating.
        const bypass = within(canvasElement).getByText('Bypass')
        expect(bypass.getClientRects().length).toBeGreaterThan(0)
    },
}
