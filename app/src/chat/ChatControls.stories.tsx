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

// The row's own reasoning-effort options — a SEPARATE list from each model's `effortLevels` above
// (ChatSession.effortOptions is session-scoped, not per-model). Every story below passes it so the
// effort Select actually renders and its `data-row-drop="2"` tier is exercised by the ladder tests
// (final-findings Group 2 #3 — previously no story gave the stub any effortOptions, so the row
// never showed an effort control at all and the ladder tier for it was untested).
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
        // Bypass's tone — Acceptance: "a dangerous mode (Bypass) is signalled by text tone only —
        // no box, no border" — now lives HERE (moved out of ChatHeader with Config/Actions
        // themselves; see final-findings Group 2 #5). Compared against the effort picker beside it
        // (a real Select here, unlike `chat-model`, which this story's single-model MODELS list
        // renders as a plain `.model-label` span with no `.ui-select-trigger` to read), the same
        // element type under the same `.row` register, so a theme change moves both and the
        // comparison holds.
        const paint = (testid: string) => {
            const trigger = canvasElement.querySelector<HTMLElement>(
                `[data-testid="${testid}"] .ui-select-trigger`,
            )!
            const cs = getComputedStyle(trigger)
            return { color: cs.color, border: cs.borderTopColor }
        }
        const armed = paint('chat-perm-mode')
        const plain = paint('chat-effort')
        expect(armed.color).not.toBe(plain.color)
        expect(armed.border).toBe(plain.border)
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

/** A daemon centre column at its narrowest (~360px — the low end of the ~300–400px range that
 *  column can shrink to). The row must stay ONE line at this width — a second line would grow
 *  taller than the no-session row beside it and shift the composer, exactly the failure the height
 *  parity above exists to prevent — so lower-priority controls (provider, then effort, then
 *  --chrome) drop instead of wrapping. */
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
                    effortOptions: EFFORT_OPTIONS,
                    effortValue: 'medium',
                })}
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        await expect(canvas.getByText('new chat')).not.toBeNull()
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        // ONE LINE, PROVEN BY OVERFLOW NOT HEIGHT (final-findings Group 2 #3). The row's own
        // `height: var(--h-control)` and `white-space` on its text never grow with content — a
        // wrapped or overflowing row does NOT report a taller `getBoundingClientRect()`, it just
        // clips or spills past the container, so the old `height < 26` assertion could never fail
        // (it was checking a value the layout cannot change). `scrollWidth <= clientWidth` is the
        // property that actually distinguishes "everything the ladder kept fits" from "it doesn't":
        // a row wider than its own box (nothing left to drop, or a threshold measured wrong) grows
        // `scrollWidth` past `clientWidth` while `clientWidth` — and therefore the old height-based
        // assertion — stays exactly the same.
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
        // The provider Select (this row's widest control, data-row-drop="1") and the effort Select
        // (data-row-drop="2") are what make room — hidden at this width (still in the DOM, per the
        // ladder's `display: none`, hence `shown` rather than `toBeNull`), while the model,
        // permission mode and new chat all survive.
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-provider"]')),
        ).toBe(false)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-effort"]')),
        ).toBe(false)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-perm-mode"]')),
        ).toBe(true)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-model"]')),
        ).toBe(true)
    },
}

/** Just above the 300px tier boundary — the tightened `//` separator margin only applies
 *  inside `@container (max-width: 300px)`, so 301px still carries the untightened `--sp-2`
 *  spacing on a row with more controls than the 260px floor's never-dropped set. Guards the
 *  301-420px band the tier switch never re-measured after `·` became `//` (final-findings
 *  Group 2 fix-1 #3). */
export const Narrow301: Story = {
    render: () => (
        <div style={{ width: '301px' }}>
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
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
    },
}

/** The daemon centre column's absolute floor (~260px). Even narrower than Narrow360 — every
 *  droppable control (provider, effort, --chrome) is gone, leaving only the never-dropped set
 *  (model, permission mode, history, new chat), and THAT set must still fit on one line. */
export const Narrow260: Story = {
    render: () => (
        <div style={{ width: '260px' }}>
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
    play: async ({ canvasElement }) => {
        const row = canvasElement.querySelector<HTMLElement>(`.${styles.row}`)!
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-provider"]')),
        ).toBe(false)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-effort"]')),
        ).toBe(false)
        // NEVER DROPPED, even at the floor.
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-model"]')),
        ).toBe(true)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-perm-mode"]')),
        ).toBe(true)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-history"]')),
        ).toBe(true)
        expect(
            shown(canvasElement.querySelector('[data-testid="chat-new"]')),
        ).toBe(true)
    },
}
