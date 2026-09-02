// Visual spec for the chat view's toolbar — the app's densest bar (13 controls) and, until this
// file existed, the only view toolbar with no story at all.
//
// WIDTH IS A STORY DIMENSION HERE, not a detail. `.viewbar` collapses on a CONTAINER query against
// itself, so it responds to the PANE, not the window, and neither Storybook's viewport addon nor
// bench/probeStory.ts (hardcoded 1280x900, no --width) can exercise that. Each story pins a real
// width on its own wrapper instead, sitting just inside a measured tier — see the ladder's comment
// in ui/ui.css for the measurement and for this bar's own column of it.
//
// EVERY VALUE IS THE REAL ONE. The provider list and the permission-mode list are imported from the
// modules that own them (chatProvider.ts, chatPermissionMode.ts) rather than retyped, so a story
// can never grade a picker against options the app does not actually offer.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import ChatHeader, { type ChatHeaderProps } from './ChatHeader'
import { CHAT_PROVIDER_OPTIONS } from '../chatProvider'
import { PERMISSION_MODE_OPTIONS } from '../chatPermissionMode'
import { chatOriginIcon } from '../chatOrigin'
import type { ChatManifest } from '../../../core/src/chat'
import styles from '../ChatHeader.module.css'

const meta = {
    title: 'Chat/ChatHeader',
    component: ChatHeader,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ChatHeader>

export default meta
type Story = StoryObj<typeof meta>

/** A plausible post-first-turn manifest: enough tools and MCP servers that both count readouts
 *  render, which is what makes them droppable in the first place. */
const MANIFEST: ChatManifest = {
    model: 'claude-opus-4-8',
    permissionMode: 'bypassPermissions',
    slashCommands: ['compact', 'clear', 'chrome'],
    tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'WebFetch'],
    mcpServers: [
        { name: 'bismuth', status: 'connected' },
        { name: 'railway', status: 'connected' },
        { name: 'chrome', status: 'failed' },
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

const EFFORTS = [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]

/** THE TITLE IS LONG ON PURPOSE, in every story. The one Critical this bar has already shipped was
 *  a `max-width` percentage resolving against the wrong box and squeezing the crumb's `b` to ZERO
 *  width — which a short title like "Chat" hides completely, because a 4-character word fits inside
 *  almost any mistake. A title that genuinely needs the ellipsis is the only kind that can fail. */
const LONG_TITLE = 'Refactoring the collapse ladder across every view bar'

const noop = () => {}

/** Every prop the bar takes, in its ordinary post-first-turn state. Stories override the few they
 *  are about — spread, not mutated, so one story can never leak into the next. */
const base: ChatHeaderProps = {
    title: LONG_TITLE,
    originIcon: chatOriginIcon('user'),
    provider: 'claude',
    providerOptions: CHAT_PROVIDER_OPTIONS,
    onSwitchProvider: noop,
    models: MODELS,
    displayModel: 'opus',
    displayModelValue: 'opus',
    onSwitchModel: noop,
    effortOptions: EFFORTS,
    effortValue: 'high',
    onSwitchEffort: noop,
    manifest: MANIFEST,
    context: { percentage: 42, totalTokens: 84_000, maxTokens: 200_000 },
    mcpConnected: 2,
    permMode: 'bypassPermissions',
    permissionModes: PERMISSION_MODE_OPTIONS,
    onSetPermissionMode: noop,
    computerUse: false,
    onToggleComputerUse: noop,
    authProviders: null,
    authOpen: false,
    onToggleAuth: noop,
    historyOpen: false,
    onOpenHistory: noop,
    historyPanel: undefined,
    onNewChat: noop,
}

/** The bar in a pane of a given width. `.chat-host` is the ancestor the header's own rules are
 *  scoped to (`.chat-host .viewbar .vb-identity`, the `.ui-select-trigger` toolbar register, the
 *  readout gap) — without it the story would render a bar none of those rules reach, and grade it
 *  green. */
function InPane(props: {
    width: number
    overrides?: Partial<ChatHeaderProps>
}) {
    return (
        <div
            class={styles['chat-host']}
            style={{ width: `${props.width}px`, height: '120px' }}
        >
            <ChatHeader {...base} {...props.overrides} />
        </div>
    )
}

const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

/** Which of the bar's controls are on screen. Every story asserts the WHOLE tuple rather than only
 *  the one thing its own tier changed — a control that drops EARLY is exactly as wrong as one that
 *  never drops, and only the full tuple can see that. */
const state = (root: Element) => ({
    tools: shown(root.querySelector('[data-testid="chat-tools"]')),
    mcp: shown(root.querySelector('[data-testid="chat-mcp"]')),
    context: shown(root.querySelector('[data-testid="chat-context"]')),
    provider: shown(root.querySelector('[data-testid="chat-provider"]')),
    model: shown(root.querySelector('[data-testid="chat-model"]')),
    effort: shown(root.querySelector('[data-testid="chat-effort"]')),
    permMode: shown(root.querySelector('[data-testid="chat-perm-mode"]')),
    history: shown(root.querySelector('[data-testid="chat-history"]')),
    newChat: shown(root.querySelector('[data-testid="chat-new"]')),
})

/** THE ASSERTION THIS BAR EXISTS TO KEEP. `.vb-identity` is capped at `44cqi`, and the last time
 *  that cap resolved against the wrong containing block it squeezed the crumb's `b` to ZERO width
 *  and `overflow: hidden` ate the title — an icon with no name on every chat tab, shipped as a
 *  Critical because every numeric probe passed: a zero-width box trivially satisfies
 *  `scrollWidth <= clientWidth`, so the usual overflow comparison is VACUOUS unless a real box is
 *  proved first. Ellipsis is expected at these widths and is not the failure; disappearing is. */
const assertTitleVisible = (root: Element, min: number) => {
    const title = root.querySelector<HTMLElement>('.crumb b')!
    expect(title.clientWidth).toBeGreaterThanOrEqual(min)
}

/** The bar's own box holds everything in it — i.e. no control has been pushed past the right edge.
 *  This is the failure the collapse tiers exist to prevent: `.vb-trail` is `flex: 0 0 auto`, so a
 *  trail wider than the bar clips New chat rather than shrinking. */
const assertBarFits = (root: Element) => {
    const bar = root.querySelector<HTMLElement>('.viewbar')!
    expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth + 1)
    const newChat = root.querySelector<HTMLElement>('[data-testid="chat-new"]')!
    expect(newChat.getBoundingClientRect().right).toBeLessThanOrEqual(
        bar.getBoundingClientRect().right + 1,
    )
}

/** Two neighbours are not FLUSH against each other. The bar runs at `--bar-icon-gap: 0` on purpose
 *  — 18px icon boxes around 12px glyphs already land on the app's 6px rhythm, and `.ui-input`
 *  controls bring `var(--sp-4)` of their own padding — so the ONLY things that can end up touching
 *  are the bare spans and the padding-less button in the row. Both of them did, when the regrouping
 *  removed the hand-tuned margins that had been standing in for a group gap: "opus" ran into "High"
 *  and "Not signed in" into the New chat glyph.
 *
 *  INK, NOT BOXES, and that distinction is the whole helper. At gap 0 every pair of boxes in this
 *  bar touches BY DESIGN — the separation is each control's own padding, inside its box — so a
 *  `right.left - left.right` comparison reads 0 for a perfectly-spaced pair and would have to be
 *  written as `>= 0`, which can never fail. Subtracting the padding measures the thing the eye
 *  actually reads. An element whose glyph is centred by flex rather than padding (the icon buttons)
 *  reports no padding and so under-states its gap, which is the safe direction for an assertion. */
const assertNotFlush = (root: Element, a: string, b: string, min: number) => {
    const ink = (s: string) => {
        const el = root.querySelector<HTMLElement>(s)!
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        return {
            left: r.left + parseFloat(cs.paddingLeft),
            right: r.right - parseFloat(cs.paddingRight),
        }
    }
    expect(ink(b).left - ink(a).right).toBeGreaterThanOrEqual(min)
}

/** The shipping shape at a comfortable pane width: all thirteen controls, nothing collapsed. The
 *  title still ellipsizes here — it is 53 characters against a 44cqi cap — but it holds a real
 *  slice of the bar, which is the thing that has to stay true. */
export const FullWidth: Story = {
    render: () => <InPane width={900} />,
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            tools: true,
            mcp: true,
            context: true,
            provider: true,
            model: true,
            effort: true,
            permMode: true,
            history: true,
            newChat: true,
        })
        // The 44cqi cap allows 380 of the 864px content box, but the trail is rigid at 577, so the
        // lead gets the 287 that is left and the title gets 264 of it (icon 15 + gap 8 take the
        // rest). 200 is the floor below which the crumb has stopped being a real slice of the bar.
        assertTitleVisible(canvasElement, 200)
        assertBarFits(canvasElement)
    },
}

/** TIER 650 (drop-4) — a 660px pane, a 624px bar. The tool and MCP counts go; the context
 *  percentage stays, and so does everything else. Above this tier the full row needs 650px, so this
 *  is the first width at which something has to give. */
export const Narrow660CountsGone: Story = {
    render: () => <InPane width={660} />,
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            tools: false,
            mcp: false,
            context: true,
            provider: true,
            model: true,
            effort: true,
            permMode: true,
            history: true,
            newChat: true,
        })
        // 80, not a token 1: the measured widths at these three tiers are 108 / 106 / 155, so a
        // threshold that only ruled out ZERO would pass a crumb collapsed to its icon and a
        // character. Ten characters is the point below which the title stops naming the chat.
        assertTitleVisible(canvasElement, 80)
        assertBarFits(canvasElement)
    },
}

/** THE REGION RULE, at the one width and state that can exercise it: tier 650 has hidden the two
 *  counts, and this session has no `context` frame yet, so `.vb-readouts` is standing over children
 *  that are ALL hidden. `.vb-trail` puts --bar-crumb-gap either side of every region, so a region
 *  left standing there charges the bar 12px for controls that are not there.
 *
 *  This is also the case the ladder's old `:only-child` form could not see — two hidden children,
 *  not one — which is why the tiers ask `:not(:has(> :not(…)))` instead. */
export const Narrow660NoContextRegionCollapses: Story = {
    render: () => <InPane width={660} overrides={{ context: null }} />,
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toMatchObject({
            tools: false,
            mcp: false,
            context: false,
        })
        const readouts =
            canvasElement.querySelector<HTMLElement>('.vb-readouts')!
        expect(readouts).not.toBeNull()
        expect(shown(readouts)).toBe(false)
        assertBarFits(canvasElement)
    },
}

/** TIER 570 (drop-3) — a 590px pane, a 554px bar. The effort picker goes: it is a property OF the
 *  selected model, so the model picker beside it still says what is answering. */
export const Narrow590EffortGone: Story = {
    render: () => <InPane width={590} />,
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            tools: false,
            mcp: false,
            context: true,
            provider: true,
            model: true,
            effort: false,
            permMode: true,
            history: true,
            newChat: true,
        })
        assertTitleVisible(canvasElement, 80)
        assertBarFits(canvasElement)
    },
}

/** TIER 500 (drop-2) — a 520px pane, a 484px bar, the narrowest state before the floor. The
 *  provider picker goes, the widest single control in the bar. What is left is exactly the set that
 *  may never go: the model, the armed permission mode, the context percentage, history and New
 *  chat. */
export const Narrow520ProviderGone: Story = {
    render: () => <InPane width={520} />,
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toEqual({
            tools: false,
            mcp: false,
            context: true,
            provider: false,
            model: true,
            effort: false,
            permMode: true,
            history: true,
            newChat: true,
        })
        assertTitleVisible(canvasElement, 80)
        assertBarFits(canvasElement)
        // The readouts region is still standing — it holds the untagged context percentage, which
        // is what stops the region rule from collapsing it along with the two counts.
        const readouts =
            canvasElement.querySelector<HTMLElement>('.vb-readouts')!
        expect(shown(readouts)).toBe(true)
        // …and the bar has NOT switched on the floor's scroll/mask treatment. Folded into this
        // tier, the fade would sit on a perfectly-fitting bar and the healthy state would ship
        // looking broken.
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(getComputedStyle(lead).overflowX).not.toBe('auto')
    },
}

/** THE FLOOR — a 460px pane, a 424px bar. A pane has no minimum width, so this state is always
 *  reachable and has to be designed rather than merely survived. `.vb-lead` goes rigid and scrolls
 *  behind a mask; `.vb-trail` stays pinned, so New chat is never what gets scrolled away. The lead's
 *  viewport is 118px here, so the title is legible and the fade reads as "more this way". */
export const Narrow460Floor: Story = {
    render: () => <InPane width={460} />,
    play: async ({ canvasElement }) => {
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        expect(getComputedStyle(lead).maskImage).not.toBe('none')
        // Rigid, not elastic — without this the crumb would ellipsize away to nothing and there
        // would be no overflow for the scroller to answer.
        const title = canvasElement.querySelector<HTMLElement>('.crumb b')!
        expect(getComputedStyle(title).flexShrink).toBe('0')
        // MEASURE THE VIEWPORT, NOT THE CHILD. A rigid child inside a scroller reports its FULL
        // content width from `clientWidth` no matter how little of it is on screen, so the obvious
        // `title.clientWidth > 0` is VACUOUS at this tier in a way it is not at any other. What has
        // to be true is that the box you can see through is big enough to read a word in.
        expect(lead.clientWidth).toBeGreaterThan(80)
        expect(lead.scrollWidth).toBeGreaterThan(lead.clientWidth)
        assertBarFits(canvasElement)
        expect(state(canvasElement)).toMatchObject({
            tools: false,
            mcp: false,
            provider: false,
            effort: false,
            context: true,
            model: true,
            permMode: true,
            newChat: true,
        })
    },
}

/** BELOW THE FLOOR — a 360px pane, a 324px bar, and the honest worst case for the densest bar in the
 *  app. The trail alone is 306px here, so the lead's viewport is the 18px that is left: the crumb
 *  shows its icon and the title is entirely scrolled off, behind a 20px mask that is wider than the
 *  box it is fading.
 *
 *  RECORDED RATHER THAN ASSERTED AWAY. The tiers cannot help — the surviving controls are the three
 *  that may never drop plus the model — and the floor's scroll is doing exactly what it was
 *  specified to do: give up the crumb before it gives up New chat. The alternative would be a bar
 *  that clips its primary action instead, which is worse. What this story exists for is to make the
 *  state visible; the screenshot is the finding, not the numbers. */
export const Cramped360BelowFloor: Story = {
    render: () => <InPane width={360} />,
    play: async ({ canvasElement }) => {
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        // The trail is whole and inside the bar — the one guarantee the floor makes.
        assertBarFits(canvasElement)
        const trail = canvasElement.querySelector<HTMLElement>('.vb-trail')!
        expect(trail.scrollWidth).toBeLessThanOrEqual(trail.clientWidth + 1)
        expect(state(canvasElement)).toMatchObject({
            tools: false,
            mcp: false,
            provider: false,
            effort: false,
            permMode: true,
            newChat: true,
        })
    },
}

/** The armed permission mode — `bypassPermissions` lets the agent write to the vault with no
 *  per-action confirmation and is the app DEFAULT, so an unindicated one is undiscoverable. It is
 *  the one control in this bar that is never tagged for the collapse ladder at any level.
 *
 *  WHAT THIS STORY FOUND, and it is the reason the bar needed a story at all. Only the CARET is
 *  tinted. `.chat-mode-select--armed:global(.ui-input)` is two classes; the toolbar register
 *  `.chat-host .viewbar .ui-select-trigger.ui-input` (below it in the same file) is FOUR, and it
 *  sets `color: var(--text-muted)` and `border-color: transparent` — so the armed rule's `color`
 *  and `border-color` are both out-specified and the word "Bypass" renders in exactly the same grey
 *  as the model picker beside it. The indicator is a 14px chevron. This predates the extraction
 *  (both rules are unchanged since 2026-08-29) and is REPORTED rather than fixed here: restoring a
 *  safety indicator is a product decision, not part of moving markup into its own file.
 *
 *  So the assertion below is the caret, which is the half that does work — and it can still fail:
 *  delete the armed caret rule and this story goes red. */
export const ArmedPermissionMode: Story = {
    render: () => <InPane width={900} />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-perm-mode"] .ui-select-trigger',
        )!
        // The hashed local first: `toContain(undefined ?? '')` is true for every string, so a
        // renamed or deleted class would make the line below pass while asserting nothing.
        expect(styles['chat-mode-select--armed']).toBeTruthy()
        expect(trigger.className).toContain(styles['chat-mode-select--armed'])
        // A real colour change, not just a class — the assertion that survives someone renaming the
        // token. Compared against the model picker's caret, i.e. the same element in an unarmed
        // control, so a theme change moves both and the comparison stays honest.
        const caret = (sel: string) =>
            getComputedStyle(
                canvasElement.querySelector<HTMLElement>(
                    `[data-testid="${sel}"] .ui-select-caret`,
                )!,
            ).color
        expect(caret('chat-perm-mode')).not.toBe(caret('chat-model'))
    },
}

/** The same bar in Default mode: no armed class, so nothing in the row is tinted. This is the
 *  control condition for the story above — without it "the caret is warning-coloured" would not
 *  distinguish an armed control from the bar's ordinary rendering. */
export const DefaultPermissionMode: Story = {
    render: () => <InPane width={900} overrides={{ permMode: 'default' }} />,
    play: async ({ canvasElement }) => {
        const trigger = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-perm-mode"] .ui-select-trigger',
        )!
        expect(trigger.className).not.toContain(
            styles['chat-mode-select--armed'] ?? 'never-matches',
        )
        const caret = (sel: string) =>
            getComputedStyle(
                canvasElement.querySelector<HTMLElement>(
                    `[data-testid="${sel}"] .ui-select-caret`,
                )!,
            ).color
        expect(caret('chat-perm-mode')).toBe(caret('chat-model'))
        assertBarFits(canvasElement)
    },
}

/** Before the first turn: no manifest, so no counts and no context — the pickers and the actions
 *  are populated from the instant the chat opens (BUG #14), which is the point of not gating them
 *  on the manifest. */
export const NoManifestYet: Story = {
    render: () => (
        <InPane
            width={900}
            overrides={{ manifest: null, context: null, models: [] }}
        />
    ),
    play: async ({ canvasElement }) => {
        expect(state(canvasElement)).toMatchObject({
            tools: false,
            mcp: false,
            context: false,
            provider: true,
            permMode: true,
            newChat: true,
        })
        // With one model there is no picker, only a bare label — and a bare label in a run of
        // padded controls is one of the two things in this bar that can end up flush.
        assertNotFlush(
            canvasElement,
            '[data-testid="chat-model"] > *',
            '[data-testid="chat-effort"] > *',
            12,
        )
        assertBarFits(canvasElement)
    },
}

/** Past 80% of the context window the readout warns, so the user knows to /compact before a turn
 *  starts failing. This is why the context percentage is never tagged for the ladder. */
export const ContextWarning: Story = {
    render: () => (
        <InPane
            width={900}
            overrides={{
                context: {
                    percentage: 91,
                    totalTokens: 182_000,
                    maxTokens: 200_000,
                },
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const pill = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-context"]',
        )!
        const plain = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-tools"]',
        )!
        expect(getComputedStyle(pill).color).not.toBe(
            getComputedStyle(plain).color,
        )
    },
}

/** An opencode session with no stored credentials: the auth pill appears in `actions` and warns,
 *  so a 401-bound session is visible before the first failed turn. opencode declares neither
 *  permissionModes nor sessionPicker, so those two controls are absent rather than broken. */
export const OpencodeSignedOut: Story = {
    render: () => (
        <InPane
            width={900}
            overrides={{
                provider: 'opencode',
                authProviders: [],
                models: [],
                effortOptions: [],
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const pill = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-auth"]',
        )!
        expect(shown(pill)).toBe(true)
        expect(styles['chat-auth-out']).toBeTruthy()
        expect(pill.className).toContain(styles['chat-auth-out'])
        expect(shown(canvasElement.querySelector('[data-testid="chat-new"]'))).toBe(
            true,
        )
        // The pill is the other padding-less control in the bar, and it sits directly beside the
        // primary action.
        assertNotFlush(
            canvasElement,
            '[data-testid="chat-auth"]',
            '[data-testid="chat-new"]',
            // 10, not 4: New chat insets its own 14px glyph by 4px inside an 18px box, so a pill
            // with NO padding still measures 4 and a `>= 4` threshold could never fail. The
            // shipping value is 12 (the pill's --sp-4 plus that 4px inset).
            10,
        )
        assertBarFits(canvasElement)
    },
}

/** …and signed in, which is the same pill in the ordinary tone. The pair is what makes the
 *  signed-out warning readable as a state: on its own a coloured pill is just a coloured pill. */
export const OpencodeSignedIn: Story = {
    render: () => (
        <InPane
            width={900}
            overrides={{
                provider: 'opencode',
                authProviders: [{ name: 'anthropic', kind: 'oauth' }],
                models: [],
                effortOptions: [],
            }}
        />
    ),
    play: async ({ canvasElement }) => {
        const pill = canvasElement.querySelector<HTMLElement>(
            '[data-testid="chat-auth"]',
        )!
        expect(shown(pill)).toBe(true)
        expect(pill.className).not.toContain(
            styles['chat-auth-out'] ?? 'never-matches',
        )
        expect(getComputedStyle(pill).color).toBe(
            getComputedStyle(
                canvasElement.querySelector<HTMLElement>(
                    '[data-testid="chat-context"]',
                )!,
            ).color,
        )
        assertBarFits(canvasElement)
    },
}
