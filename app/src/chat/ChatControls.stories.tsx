// Visual spec for <ChatControls> — the quiet inline controls row for a host with no ViewBar (the
// daemon page). The header's readouts are ChatReadouts.stories.tsx, and ChatHeader.stories.tsx
// renders them through the real bar.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor, within } from 'storybook/test'
import ChatControls from './ChatControls'
import { ToastHost } from '../ui/ToastHost'
import { makeStubChatSession } from './_stubChatSession'
import { CONVERSATION_ITEMS } from './_transcriptFixtures'
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
        // Readouts are OMITTED from the row (Acceptance) — the context meter is the header's.
        expect(
            canvasElement.querySelector('[data-testid="chat-context"]'),
        ).toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-perm-mode"]'),
        ).not.toBeNull()
        await expect(
            canvasElement.querySelector('[data-testid="chat-new"]'),
        ).not.toBeNull()
        // Provider/model/effort no longer render as separate controls — they're folded behind the
        // model word (ChatModelMenu). One control, not three.
        expect(
            canvasElement.querySelector('[data-testid="chat-provider"]'),
        ).toBeNull()
        expect(
            canvasElement.querySelector('[data-testid="chat-effort"]'),
        ).toBeNull()
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
        // Acceptance 7: "opus 4.8 // bypass // [history] [new chat]" — `history` and `new chat`
        // are both real bracket TextButtons (button-family migration, no PlainButton). CLOSED
        // `history` now inks like `new chat` (both `normal`): it used to take the `unselected`
        // variant and read grey beside a near-white `[+ new chat]`, as if disabled. Only the OPEN
        // toggle is `selected`.
        const history = within(canvasElement).getByTestId('chat-history')
        const newChat = within(canvasElement).getByTestId('chat-new')
        expect(history.tagName).toBe('BUTTON')
        expect(newChat.tagName).toBe('BUTTON')
        expect(getComputedStyle(history).color).toBe(
            getComputedStyle(newChat).color,
        )
        // The `//` separator lands on the ACTIONS CLUSTER as a whole (one `//` before it,
        // separating it from the permission-mode readout), never between the two bracket buttons
        // it contains — brackets already separate adjacent commands.
        const actionsCluster = canvasElement.querySelector<HTMLElement>(
            `.${styles.actions}`,
        )!
        expect(getComputedStyle(actionsCluster, '::before').content).toContain(
            '//',
        )
    },
}

/** The private toggle, off: a bare eye-slash between `history` and `new chat`. */
export const PrivateOff: Story = {
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
        const c = within(canvasElement)
        const toggle = c.getByTestId('chat-private-toggle')
        expect(toggle.getAttribute('aria-label')).toBe('private')
        expect(toggle.getAttribute('aria-pressed')).toBe('false')
        expect(c.getByTestId('chat-history')).not.toBeNull()
    },
}

/** The private toggle, on: the conversation is erased when it ends. `history` stays, since opening
 *  another conversation simply ends this one. */
export const PrivateOn: Story = {
    render: () => (
        <ChatControls
            session={makeStubChatSession({
                isPrivate: true,
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
        const c = within(canvasElement)
        const toggle = c.getByTestId('chat-private-toggle')
        expect(toggle.getAttribute('data-tooltip')).toContain(
            'erased when it ends',
        )
        expect(toggle.getAttribute('aria-pressed')).toBe('true')
        expect(c.getByTestId('chat-history')).not.toBeNull()
    },
}

/** Flipping the toggle mid-chat: one click turns it on, a second turns it back off, and each click
 *  confirms itself with a toast saying what happens to the conversation, replacing the last one. */
export const PrivateToggleMidChat: Story = {
    render: () => (
        <>
            <ChatControls
                session={makeStubChatSession({
                    manifest: MANIFEST,
                    transcript: [...CONVERSATION_ITEMS],
                    models: MODELS,
                    displayModel: 'opus',
                    displayModelValue: 'opus',
                    permMode: 'bypassPermissions',
                    effortOptions: EFFORT_OPTIONS,
                    effortValue: 'medium',
                })}
            />
            <ToastHost />
        </>
    ),
    play: async ({ canvasElement }) => {
        const toggle = within(canvasElement).getByTestId('chat-private-toggle')
        const title = () => toggle.getAttribute('data-tooltip') ?? ''
        const toastText = () =>
            [...document.querySelectorAll('[data-tone]')]
                .map(t => t.textContent ?? '')
                .join(' | ')
        expect(title()).toContain('Make private')
        toggle.click()
        await waitFor(() => expect(title()).toContain('erased when it ends'))
        await waitFor(() =>
            expect(toastText()).toContain(
                'Private: this conversation is erased when it ends',
            ),
        )
        toggle.click()
        await waitFor(() => expect(title()).toContain('Make private'))
        // The second click replaces the first toast instead of stacking under it.
        await waitFor(() =>
            expect(toastText()).toBe('This conversation will be kept'),
        )
    },
}

/** No session yet: the interface says "renders the row disabled at the SAME height" — rendered
 *  here side by side with an armed row at the same width so the play() can prove the height
 *  claim directly rather than assuming it from the markup. */
export const NoSession: Story = {
    render: () => (
        <div
            style={{ display: 'flex', 'flex-direction': 'column', gap: '24px' }}
        >
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
        // THE DISABLED LOOK IS INK, NEVER OPACITY (DESIGN.md:426-428): the row and everything in
        // it paints at full opacity — a dimmed row put the model word at 1.8:1 — and the model
        // word steps down to `--faint` against the armed row's `--text-muted`.
        for (const el of [
            noSession,
            ...Array.from(noSession.querySelectorAll<HTMLElement>('*')),
        ]) {
            expect(getComputedStyle(el).opacity).toBe('1')
        }
        const probe = (token: string) => {
            const p = document.createElement('span')
            p.style.color = `var(${token})`
            canvasElement.appendChild(p)
            const color = getComputedStyle(p).color
            p.remove()
            return color
        }
        const wordOf = (row: HTMLElement) =>
            row.querySelector<HTMLElement>(
                '[data-testid="chat-model"] button, [data-testid="chat-model"] span',
            )!
        const disabledInk = getComputedStyle(wordOf(noSession)).color
        const armedInk = getComputedStyle(wordOf(armed)).color
        expect(disabledInk).toBe(probe('--faint'))
        expect(armedInk).toBe(probe('--text-muted'))
        expect(disabledInk).not.toBe(armedInk)
    },
}

/** Width samples proving the row can never overflow its own box — there is no longer a
 *  narrow-width ladder that DROPS controls at measured breakpoints (Task 2: "no pixel ladder").
 *  The model control is the main thing that shrinks (flex-shrink + a 3ch floor + ellipsis in
 *  ChatModelMenu.module.css/ChatControls.module.css); permission mode, history and new chat always
 *  keep their full CONTROL — but below the row's own `@container chatrow` tier (280px,
 *  ChatControls.module.css), history/new-chat give up their WORD (`data-row-label`) and render
 *  icon-only, which is what frees the room the floored model word needs rather than the model word
 *  giving up its own floor. `scrollWidth <= clientWidth` is what actually proves "nothing spills
 *  past the container" — a row wider than its own box grows `scrollWidth` past `clientWidth` while
 *  `clientWidth` (and any height-based assertion) stays exactly the same. */
const overflowProof = (widthPx: number, openInChat = false) => ({
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
                    transcript: openInChat ? [...CONVERSATION_ITEMS] : [],
                })}
                onOpenInChat={openInChat ? () => {} : undefined}
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
            canvasElement
                .querySelector('[data-testid="chat-perm-mode"]')!
                .getClientRects().length,
        ).toBeGreaterThan(0)
        // The row's one collapse tier: below 280px the worded twin (`data-row-label`) of
        // `[history]`/`[new chat]` hides for its bare icon twin, which frees room for the floored
        // model word; at and above 280px the label stays. Read from the LIVE trigger's computed
        // style, not a hand-picked class, so this fails if the container-query threshold drifts.
        const newChatWorded = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-new"]',
        )!
        const newChatIcon = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-new-icon"]',
        )!
        const collapsed = getComputedStyle(newChatWorded).display === 'none'
        expect(collapsed).toBe(widthPx <= 280)
        if (openInChat) {
            const open = canvasElement.querySelector<HTMLElement>(
                '[data-testid="chat-open-in-chat"]',
            )!
            expect(open.getClientRects().length).toBeGreaterThan(0)
        }
        // The twins swap: exactly one of the pair is ever laid out, and the bare icon never draws
        // a bracket while off (it is a one-shot action, `normal`).
        expect(getComputedStyle(newChatIcon).display === 'none').toBe(
            !collapsed,
        )
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

/** The `.row`'s 2px right inset absorbs an overhang whose exact box was never isolated, so one
 *  width proving "no overflow" is thin evidence — these two sit either side of the 280px
 *  `@container chatrow` tier (where history/new chat give up their word) to prove the inset holds
 *  across it, not just at 240/260/360. */
export const Narrow280: Story = overflowProof(280)
export const Narrow320: Story = overflowProof(320)

/** The daemon page's row once it has a conversation carries a fifth item, the `[↗]` open-in-chat
 *  icon; it must still fit on one line at the column's widths. */
export const Narrow360OpenInChat: Story = overflowProof(360, true)
export const Narrow260OpenInChat: Story = overflowProof(260, true)

/** `[↗]` open in chat — the daemon page's hand-off (only a host that passes `onOpenInChat` gets
 *  it). Three rows at one width: nothing said yet (absent, so the resting row is unchanged), a
 *  conversation (enabled, an icon-only bracket heading the actions cluster on history's line), and a
 *  turn still streaming (enabled too — the live session moves, so the reply keeps streaming in the
 *  new tab). */
export const OpenInChat: Story = {
    render: () => {
        const base = {
            manifest: MANIFEST,
            models: MODELS,
            displayModel: 'opus',
            displayModelValue: 'opus',
            permMode: 'bypassPermissions',
            effortOptions: EFFORT_OPTIONS,
            effortValue: 'medium',
        }
        return (
            <div
                style={{
                    display: 'flex',
                    'flex-direction': 'column',
                    gap: '24px',
                    width: '520px',
                }}
            >
                <ChatControls
                    session={makeStubChatSession(base)}
                    onOpenInChat={() => {}}
                    class="at-rest"
                />
                <ChatControls
                    session={makeStubChatSession({
                        ...base,
                        transcript: [...CONVERSATION_ITEMS],
                    })}
                    onOpenInChat={() => {}}
                    class="conversing"
                />
                <ChatControls
                    session={makeStubChatSession({
                        ...base,
                        transcript: [...CONVERSATION_ITEMS],
                        streaming: true,
                    })}
                    onOpenInChat={() => {}}
                    class="streaming"
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const open = (row: string) =>
            canvasElement.querySelector<HTMLButtonElement>(
                `.${row} [data-testid="chat-open-in-chat"]`,
            )
        await expect(open('at-rest')).toBeNull()
        const live = open('conversing')!
        await expect(live.disabled).toBe(false)
        await expect(open('streaming')!.disabled).toBe(false)
        // On its neighbours' line: one shared row top and one height.
        const history = canvasElement.querySelector<HTMLElement>(
            '.conversing [data-testid="chat-history"]',
        )!
        const a = live.getBoundingClientRect()
        const b = history.getBoundingClientRect()
        await expect(Math.abs(a.top - b.top)).toBeLessThan(1)
        await expect(Math.abs(a.height - b.height)).toBeLessThan(1)
        await expect(a.right).toBeLessThanOrEqual(b.left)
        // Adding it never changes the row's height.
        const rows = canvasElement.querySelectorAll<HTMLElement>(
            `.${styles.row}`,
        )
        await expect(
            Math.abs(rows[0].offsetHeight - rows[1].offsetHeight),
        ).toBeLessThan(1)
    },
}

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
