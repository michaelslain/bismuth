// Visual spec for <ViewBar> + <Crumb> — the canonical 36px view header used across
// graph/bases/calendar/flashcards. The bar takes NAMED REGION SLOTS (identity · locus · facet on
// the left, readouts · config · actions on the right), not positional children, so these stories
// compose it exactly as call sites do (see GraphView.tsx / bases/BaseView.tsx) rather than
// rendering each piece in isolation.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { createSignal, Show, type JSX } from 'solid-js'
import ViewBar, { Crumb } from './ViewBar'
import { SegmentedToggle } from './SegmentedToggle'
import { IconButton } from './IconButton'
import { TextButton } from './TextButton'
import Text from './Text'
import { createPaneChrome, PaneChromeContext } from './paneChrome'

const meta = {
    title: 'UI/ViewBar',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ViewBar is a bare header strip (no side padding beyond its own), so give the story
// canvas a body to sit above, matching a real content view.
function Frame(props: { children: JSX.Element; w?: string }) {
    return (
        <div
            style={{
                width: props.w ?? '640px',
                border: '1px solid var(--border)',
                'border-radius': 'var(--r-0)',
                overflow: 'hidden',
                background: 'var(--bg)',
            }}
        >
            {props.children}
            <div
                style={{
                    height: '160px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    color: 'var(--faint)',
                    'font-size': 'var(--fs-body)',
                }}
            >
                (view content)
            </div>
        </div>
    )
}

/** A breadcrumb only — the simplest bar (e.g. a single-view base with no tabs). */
export const CrumbOnly: Story = {
    render: () => (
        <Frame>
            <ViewBar identity={<Crumb icon="Table">Reading List</Crumb>} />
        </Frame>
    ),
}

/** Breadcrumb + view tabs + a settings toggle on the right (the Bases shape). */
export const WithTabsAndActions: Story = {
    render: () => {
        const [view, setView] = createSignal(0)
        const [settingsOpen, setSettingsOpen] = createSignal(false)
        return (
            <Frame>
                <ViewBar
                    identity={<Crumb icon="Table">Reading List</Crumb>}
                    facet={
                        <SegmentedToggle
                            value={view()}
                            onChange={setView}
                            options={[
                                { id: 0, label: 'Table' },
                                { id: 1, label: 'Cards' },
                                { id: 2, label: 'Kanban' },
                            ]}
                        />
                    }
                    actions={
                        <>
                            <IconButton
                                icon="Settings"
                                label="Settings"
                                variant={settingsOpen() ? 'selected' : 'unselected'}
                                onClick={() => setSettingsOpen(v => !v)}
                            />
                            <IconButton icon="Code" label="Source" />
                        </>
                    }
                />
            </Frame>
        )
    },
}

/** A crumb title + a mode switcher on the far right — the Knowledge Graph header shape. */
export const CrumbWithModeSwitcher: Story = {
    render: () => {
        const [mode, setMode] = createSignal('2d')
        return (
            <Frame>
                <ViewBar
                    identity={
                        <Crumb icon="Share2">
                            Knowledge Graph
                        </Crumb>
                    }
                    facet={
                        /* 2D/3D is `facet` — "which projection of the same thing" — not `config`.
                           Tasks 5-7 copy their region choices from this file, so the example has
                           to name the region the vocabulary in ViewBar.tsx actually implies. */
                        <SegmentedToggle
                            value={mode()}
                            onChange={setMode}
                            size="sm"
                            options={[
                                { id: '2d', label: '2D' },
                                { id: '3d', label: '3D' },
                            ]}
                        />
                    }
                />
            </Frame>
        )
    },
}

/** Every region populated at once — the layout contract each view composes against. */
export const AllRegions: Story = {
    render: () => (
        <Frame>
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                locus={<IconButton icon="ChevronLeft" label="Previous" />}
                facet={<TextButton variant="selected">table</TextButton>}
                readouts={<Text as="span" size="ui" tone="muted">42 rows</Text>}
                config={<IconButton icon="Settings" label="Settings" />}
                actions={<IconButton icon="Plus" label="New" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')!
        // All six regions, in the documented order, split across the two groups. `data-testid`
        // rather than a `[class^="vb-"]` prefix match: ViewBar.module.css's classes are hashed
        // locals now, so the class attribute no longer starts with the literal "vb-".
        const order = [
            ...bar.querySelectorAll<HTMLElement>('[data-testid^="vb-"]'),
        ].map(e => e.dataset.testid)
        expect(order).toEqual([
            'vb-lead',
            'vb-identity',
            'vb-locus',
            'vb-facet',
            'vb-trail',
            'vb-readouts',
            'vb-config',
            'vb-actions',
        ])
        // One band, and the trailing group really is pushed to the right edge.
        const barBox = bar.getBoundingClientRect()
        const trailBox = bar
            .querySelector('[data-testid="vb-trail"]')!
            .getBoundingClientRect()
        expect(Math.round(barBox.height)).toBe(36)
        expect(Math.round(barBox.right - trailBox.right)).toBe(12) // the bar's own padding (--sp-5, via Band)
    },
}

/** No slot but identity — the bar must not render empty region wrappers or their gaps. */
export const IdentityOnly: Story = {
    render: () => (
        <Frame>
            <ViewBar identity={<Crumb icon="Inbox">Inbox</Crumb>} />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')!
        expect(bar.querySelector('[data-testid="vb-lead"]')!.children.length).toBe(1)
        expect(bar.querySelector('[data-testid="vb-trail"]')!.children.length).toBe(0)
        expect(bar.querySelector('[data-testid="vb-identity"]')).not.toBeNull()
    },
}

/**
 * THE GUARD FOR `filled()`. This is the one shape that tells two implementations apart.
 *
 * `children()` resolves a FRAGMENT to an array holding one entry per child — even for children that
 * rendered nothing — so two collapsed `<Show>`s come back as `[undefined, undefined]`, whose length
 * is 2. A `length > 0` check calls that populated and emits an empty `.vb-actions` div plus the
 * `.vb-trail` gap beside it; `filled()` inspects the ENTRIES instead and correctly reports empty.
 *
 * Every other story here passes single elements or a plain `undefined`, which BOTH implementations
 * handle identically — so without this one, a later "simplification" back to a length check would
 * leave the unit suite and the whole bench sweep green while every bar in the app silently grew
 * phantom regions. `config` is a plain `undefined` and `actions` is the fragment, so the assertions
 * cover the trivial case and the one that actually regresses.
 */
export const EmptyTrailingRegions: Story = {
    render: () => (
        <Frame>
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                config={undefined}
                actions={
                    <>
                        <Show when={false}>
                            <IconButton icon="Plus" label="New" />
                        </Show>
                        <Show when={false}>
                            <IconButton icon="Settings" label="Settings" />
                        </Show>
                    </>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('Reading List')).toBeInTheDocument()
        const bar = canvasElement.querySelector('[data-viewbar]')!
        // ZERO element children. Under a `length > 0` check this is 1 — an empty .vb-actions.
        expect(bar.querySelector('[data-testid="vb-trail"]')!.children.length).toBe(0)
        // The leading group still renders exactly the one region that IS populated.
        const lead = bar.querySelector('[data-testid="vb-lead"]')!
        expect(lead.children.length).toBe(1)
        expect(lead.querySelector('[data-testid="vb-identity"]')).not.toBeNull()
        // And no region wrapper anywhere in the bar is empty.
        for (const r of bar.querySelectorAll(
            '[data-testid="vb-identity"], [data-testid="vb-locus"], [data-testid="vb-facet"], ' +
                '[data-testid="vb-readouts"], [data-testid="vb-config"], [data-testid="vb-actions"]',
        ))
            expect(r.children.length).toBeGreaterThan(0)
    },
}

/**
 * A region whose slot holds ONLY TEXT still renders below the collapse tiers.
 *
 * The drop tiers hide a region wrapper left standing over children the tier just hid, and they ask
 * that as `:not(:has(> :not([data-bar-drop='N'])))`. That predicate is VACUOUSLY TRUE for an element
 * with no element children at all — `:has(> :not(X))` cannot match one — so without the `:has(> *)`
 * guard in front of it, a slot passed a bare string gets `display: none` the moment the bar is
 * narrower than the widest tier. No error, no console warning, no typecheck complaint: the region
 * simply stops existing. The rule this replaced (`:has(> [data-bar-drop='1']:only-child)`) required
 * a child, so it could never do this; the generalized form can, and that is the cost of generalizing.
 *
 * `Frame` is 640px and `.viewbar` carries 18px of padding a side, so the container measures 604 —
 * already inside the widest drop tier (650). This story is therefore ALWAYS in the dangerous band;
 * it needs no special width to be a real test.
 */
export const TextOnlyRegionSurvivesTheTiers: Story = {
    render: () => (
        <Frame>
            <ViewBar
                identity={<Crumb icon="Inbox">Inbox</Crumb>}
                readouts={'12 unread'}
                actions={<IconButton icon="Plus" label="New" size="sm" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        // The container really is inside the tier — otherwise this story proves nothing.
        expect(bar.clientWidth).toBeLessThanOrEqual(650)
        const readouts = bar.querySelector<HTMLElement>('[data-testid="vb-readouts"]')!
        // Text-only, so ZERO element children — the exact shape the predicate is vacuous for.
        expect(readouts.children.length).toBe(0)
        expect(readouts.textContent).toBe('12 unread')
        // …and it is still painted. `display` rather than a rect, because the assertion has to name
        // the property the tier would have set; a width check would also fail for a dozen unrelated
        // reasons and would not say which one.
        expect(getComputedStyle(readouts).display).not.toBe('none')
        expect(readouts.getClientRects().length).toBeGreaterThan(0)
    },
}

/**
 * The same guard, on the region that would actually break the layout. `ui/ViewBar.tsx` renders
 * `.vb-lead` and `.vb-trail` unconditionally, so both are permanent candidates for the tier rules,
 * and `.vb-lead` is the `flex: 1 1 auto` spacer that `justify-content: space-between` depends on:
 * hide it and `.vb-trail` becomes the only visible child, so the whole trailing group snaps to the
 * LEFT edge. No shipping call site can empty it today (every bar has an identity), which is exactly
 * why it needs a story — a latent break with no consumer is one nobody notices until there is one.
 */
export const EmptyLeadKeepsTheTrailPinnedRight: Story = {
    render: () => (
        <Frame>
            <ViewBar
                actions={<IconButton icon="Plus" label="New" size="sm" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        expect(bar.clientWidth).toBeLessThanOrEqual(650)
        const lead = bar.querySelector<HTMLElement>('[data-testid="vb-lead"]')!
        // Genuinely empty — no identity, locus or facet slot was passed.
        expect(lead.children.length).toBe(0)
        expect(getComputedStyle(lead).display).not.toBe('none')
        // The load-bearing consequence: the trailing group is still on the right. Measured against
        // the bar's own box, so its 18px padding is not mistaken for a gap.
        const trail = bar.querySelector<HTMLElement>('[data-testid="vb-trail"]')!
        const barBox = bar.getBoundingClientRect()
        const trailBox = trail.getBoundingClientRect()
        expect(barBox.right - trailBox.right).toBeLessThanOrEqual(19)
        // Not merely "somewhere" — a collapsed .vb-lead would put it hard against the left padding.
        expect(trailBox.left - barBox.left).toBeGreaterThan(100)
    },
}

/**
 * BELOW THE FLOOR (queue item 8). global.css's `ui/ui.css` section's `@container viewbar
 * (max-width: 430px)` rule makes
 * `.vb-lead` scroll (`overflow-x: auto` + a right-edge fade mask) instead of letting the row overflow
 * the bar or push `.vb-trail` off it. That rule applies to ALL SIX bars built on `<ViewBar>`, but
 * every OTHER story in this file mounts at 640px — above every tier — so until now the floor was
 * exercised only through the calendar's own stories (whose narrow-pane cases happen to cross it) and
 * a regression in the shared rule would have shown up in exactly one consumer's tests and looked like
 * a calendar-only bug. This story gives the shared rule a non-calendar guard, using `AllRegions`'
 * same six-region composition — the densest bar this file builds — so the scrolling group actually
 * has content to scroll.
 *
 * WIDTH: `Frame w="400px"` renders a `.viewbar` measuring 398x36 (`probeStory.ts`, its own 1px border
 * either side of the 400px frame), whose content box — what the container query actually sees, since
 * it sits inside the bar's own `padding: 0 18px` — is 362px. That is 68px below the 430px floor-tier
 * boundary (`@container viewbar (max-width: 430px)` in ViewBar.module.css): deep enough that a small change to
 * `--h-band` or the bar's own padding cannot drift the story across the line and turn it into a
 * confusing failure in some other tier's territory. (400 is chosen as a round, deliberately-narrow
 * story width, not because it sits near any tier edge — contrast `FlashcardsTight`'s 502px, which is
 * measured *right up against* the 465px DROP-1 boundary on purpose.)
 */
export const BelowFloor: Story = {
    render: () => (
        // 260px, not the old 400px: the one-button pass shrank TextButton/IconButton (VBtn's
        // padded box is gone), so at 400px the lead group's minimum
        // content now fits without scrolling and this story proved nothing. 260px keeps a real
        // shortfall now that the bar pads 12px a side (re-measured 2026-10-06: 300px no longer
        // overflowed, the lead fit at 176px exactly),
        // still comfortably below the 430px floor tier.
        <Frame w="260px">
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                locus={<IconButton icon="ChevronLeft" label="Previous" />}
                facet={<TextButton variant="selected">table</TextButton>}
                readouts={<Text as="span" size="ui" tone="muted">42 rows</Text>}
                config={<IconButton icon="Settings" label="Settings" />}
                actions={<IconButton icon="Plus" label="New" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        // The container really is below the floor boundary — otherwise this story proves nothing.
        expect(bar.clientWidth).toBeGreaterThan(0)
        expect(bar.clientWidth).toBeLessThanOrEqual(260)

        const lead = canvasElement.querySelector<HTMLElement>('[data-testid="vb-lead"]')!
        expect(lead).toBeTruthy()
        expect(lead.clientWidth).toBeGreaterThan(0)

        // The floor tier fired: the lead group scrolls rather than pushing the trail off the bar.
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        expect(lead.scrollWidth).toBeGreaterThan(lead.clientWidth)
        // …and because it really overflows, its right edge fades to say "more this way".
        expect(lead.hasAttribute('data-overflowing')).toBe(true)
        expect(getComputedStyle(lead).maskImage).not.toBe('none')

        // And the trail is still fully on the bar — the thing the floor tier exists to protect.
        // `clientWidth > 0` first: a right-edge comparison against a zero-width box is vacuously
        // true, which is exactly the shape of Critical this plan's predecessor shipped.
        const trail = canvasElement.querySelector<HTMLElement>('[data-testid="vb-trail"]')!
        expect(trail.clientWidth).toBeGreaterThan(0)
        expect(trail.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right + 0.5,
        )

        /* KNOWN, not fixed here: `overflow-x: auto` with `overflow-y: visible` computes overflow-y
         * to `auto` too, so a focused button's outline-offset inside `.vb-lead` gets clipped by
         * the scrolling band. Reported to the controller rather than fixed here — the rule lives in
         * ui/ViewBar.module.css, which is another task's file. */
    },
}

/**
 * Below the floor tier, but the lead FITS: no fade. The shape of the sidebar mini graph — a 266px
 * bar whose lead is one button and a few icons, with two icon toggles trailing. The floor tier's
 * scroller is on, yet nothing is past the edge, so the lead's last control must not be masked (an
 * unconditional mask read as a dark band between the icons and the trailing [clusters]).
 */
export const BelowFloorLeadFits: Story = {
    render: () => (
        <Frame w="266px">
            <ViewBar
                locus={<TextButton variant="unselected">3d</TextButton>}
                facet={
                    <>
                        <IconButton icon="Notebook" label="2nd brain" />
                        <IconButton icon="Brain" label="3rd brain" />
                    </>
                }
                config={
                    <>
                        <IconButton icon="CirclesThree" label="clusters" variant="selected" />
                        <IconButton icon="Crosshair" label="local" variant="unselected" />
                    </>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        expect(bar.clientWidth).toBeLessThanOrEqual(266)
        const lead = canvasElement.querySelector<HTMLElement>('[data-testid="vb-lead"]')!
        // The floor tier is on (the lead would scroll if it had to)…
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        // …but it fits, so no edge of it is faded.
        expect(lead.scrollWidth).toBeLessThanOrEqual(lead.clientWidth + 1)
        expect(lead.hasAttribute('data-overflowing')).toBe(false)
        expect(getComputedStyle(lead).maskImage).toBe('none')
    },
}

/** A pane's chrome, posed without PaneLeaf: `split` is the only input that matters to the bar. */
function InPane(props: { split: boolean; children: JSX.Element }) {
    const chrome = createPaneChrome({
        split: () => props.split,
        focused: () => true,
        close: () => {},
        startDrag: () => {},
    })
    return (
        <PaneChromeContext.Provider value={chrome}>
            {props.children}
        </PaneChromeContext.Provider>
    )
}

/**
 * PANE CHROME (ui/paneChrome.ts). Inside a SPLIT pane the bar claims the pane's close + drag: the
 * [×] is the trail's last group, after the primary action, and the bar is the drag handle
 * (`data-pane-chrome`, grab cursor). This is what replaces PaneHeader stacked over the bar
 * repeating the same icon and name — see App/PaneTree's RowSplitBarBesideNote for the two side by
 * side.
 */
export const InSplitPane: Story = {
    render: () => (
        <Frame>
            <InPane split={true}>
                <ViewBar
                    identity={
                        <Crumb icon="FileText">
                            Topic 6: Market power and antitrust.pdf
                        </Crumb>
                    }
                    readouts={<Text tone="muted">p. 8 / 56</Text>}
                    config={<TextButton title="Fit width">fit</TextButton>}
                    actions={<IconButton icon="PanelRight" label="Bookmarks" />}
                />
            </InPane>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')!
        await expect(bar.hasAttribute('data-pane-chrome')).toBe(true)
        const trail = bar.querySelector('[data-testid="vb-trail"]')!
        await expect(trail.lastElementChild?.getAttribute('data-testid')).toBe(
            'vb-pane',
        )
        await expect(
            within(bar as HTMLElement).getByLabelText('Close pane'),
        ).toBeTruthy()
    },
}

/** An UNSPLIT tab has no pane chrome: the bar claims, but draws no [×] and is no drag handle —
 *  identical to a bar outside any pane. */
export const InUnsplitPane: Story = {
    render: () => (
        <Frame>
            <InPane split={false}>
                <ViewBar identity={<Crumb icon="FileText">example.ts</Crumb>} />
            </InPane>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('[data-viewbar]')!
        await expect(bar.hasAttribute('data-pane-chrome')).toBe(false)
        await expect(bar.querySelector('[data-testid="vb-pane"]')).toBeNull()
    },
}

/** FIRST CLAIMANT WINS: a view that nests a second bar (the daemon page's bar, then its chat's
 *  header) shows the [×] once, on the first. */
export const NestedBarsFirstClaims: Story = {
    render: () => (
        <Frame>
            <InPane split={true}>
                <ViewBar identity={<Crumb icon="Bot">Daemon</Crumb>} />
                <ViewBar identity={<Crumb icon="MessageSquare">Chat</Crumb>} />
            </InPane>
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bars = canvasElement.querySelectorAll('[data-viewbar]')
        await expect(bars.length).toBe(2)
        await expect(
            bars[0].querySelector('[data-testid="vb-pane"]'),
        ).not.toBeNull()
        await expect(
            bars[1].querySelector('[data-testid="vb-pane"]'),
        ).toBeNull()
        await expect(bars[1].hasAttribute('data-pane-chrome')).toBe(false)
    },
}

/** `flush` — the bar draws no side padding of its own, for a host that owns it (BaseView). Stacked
 *  against a default bar: the crumb's icon sits at the frame edge, and the bottom hairline is
 *  still there, because padding and the rule are independent. */
export const Flush: Story = {
    render: () => (
        <Frame>
            <ViewBar identity={<Crumb icon="Share2">default padding</Crumb>} />
            <ViewBar flush identity={<Crumb icon="Share2">flush</Crumb>} />
        </Frame>
    ),
}


// ---- fit-driven drop + the [≡] overflow panel ----------------------------------------------
// A trail element tagged `data-bar-drop` drops only when the bar genuinely cannot hold it (see
// ui/barFit.ts), and [≡] exists only while something is hidden.

const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

/** A PDF-shaped bar: a never-dropping page readout, then three droppable groups (dark 4, zoom 3,
 *  file 2). The dark group holds a `<Show>` so node identity can be proved while it sits in the
 *  panel. */
function ManyControlsBar(props: { w: string; sm?: boolean }) {
    const size = () => (props.sm ? ('sm' as const) : undefined)
    const [dark, setDark] = createSignal(false)
    return (
        <Frame w={props.w}>
            <ViewBar
                identity={<Crumb icon="FileText">annotated.pdf</Crumb>}
                readouts={<Text tone="muted">p. 2 / 4</Text>}
                config={
                    <>
                        <div
                            data-bar-drop="3"
                            data-bar-menu-label="zoom"
                        >
                            <div style={{ display: 'flex', 'align-items': 'center' }}>
                            <IconButton icon="Minus" label="Zoom out" size={size()} />
                            <Text tone="muted">100%</Text>
                            <IconButton icon="Plus" label="Zoom in" size={size()} />
                            </div>
                        </div>
                        <div
                            data-bar-drop="4"
                            data-bar-menu-label="dark mode"
                        >
                            <div style={{ display: 'flex', 'align-items': 'center' }}>
                            <IconButton
                                icon="Moon"
                                label="Dark"
                                size={size()}
                                variant={dark() ? 'selected' : 'unselected'}
                                onClick={() => setDark(v => !v)}
                            />
                            <Show when={dark()}>
                                <Text as="span" tone="muted">on</Text>
                            </Show>
                            </div>
                        </div>
                    </>
                }
                actions={
                    <div
                        data-bar-drop="2"
                        data-bar-menu-label="file"
                    >
                        <div style={{ display: 'flex', 'align-items': 'center' }}>
                        <TextButton>to-markdown</TextButton>
                        <TextButton>open</TextButton>
                        <TextButton>reveal</TextButton>
                        </div>
                    </div>
                }
            />
        </Frame>
    )
}

/** Plenty of room: every droppable control is in the bar, nothing carries `data-bar-hidden`, and
 *  there is no [≡]. */
export const ManyControlsWide: Story = {
    render: () => <ManyControlsBar w="900px" />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        await new Promise(r =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
        )
        expect(bar.querySelectorAll('[data-bar-hidden]').length).toBe(0)
        expect(bar.querySelectorAll('[data-bar-drop]').length).toBe(3)
        for (const el of bar.querySelectorAll('[data-bar-drop]')) expect(shown(el)).toBe(true)
        expect(within(bar).queryByLabelText('More controls')).toBeNull()
    },
}

/** Not enough room: the dark group (level 4) is hidden from the bar and [≡] is the trail's last
 *  control. The panel lists the dropped groups with their LIVE controls: pressing dark inside the
 *  panel toggles the real state (same node, selected), a `<Show>` inside it still reacts, and Escape,
 *  an outside press and a resize each close the panel and put the element back where it was. */
export const ManyControlsNarrowOverflow: Story = {
    render: () => <ManyControlsBar w="380px" />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const trail = bar.querySelector<HTMLElement>('[data-testid="vb-trail"]')!
        const dark = bar.querySelector<HTMLElement>('[data-bar-menu-label="dark mode"]')!
        const home = dark.parentElement!
        const trigger = await waitFor(() => {
            const t = within(bar).getByLabelText('More controls')
            expect(t).toBeTruthy()
            return t
        })
        expect(trail.lastElementChild).toBe(trigger)
        expect(dark.hasAttribute('data-bar-hidden')).toBe(true)
        expect(shown(dark)).toBe(false)
        const darkButton = within(dark).getByLabelText('Dark')

        const open = async () => {
            await userEvent.click(trigger)
            return await waitFor(() => {
                const p = document.body.querySelector<HTMLElement>('[data-popover]')
                expect(p).toBeTruthy()
                return p!
            })
        }

        // OPEN: the same element now lives in the panel, labelled, and shown.
        let panel = await open()
        expect(panel.contains(dark)).toBe(true)
        expect(bar.contains(dark)).toBe(false)
        expect(within(panel).getByText('dark mode')).toBeTruthy()
        expect(shown(dark)).toBe(true)
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
        // The panel hangs inside the bar's right edge (end-aligned), with no tooltip over it.
        expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(bar.getBoundingClientRect().right + 1)
        expect(document.querySelector('[data-tooltip-bubble]')).toBeNull()

        // PRESS the dropped toggle inside the panel: it is the real control.
        await userEvent.click(darkButton)
        expect(within(panel).getByLabelText('Dark')).toBe(darkButton)
        expect(darkButton.getAttribute('aria-pressed')).toBe('true')
        expect(within(dark).getByText('on')).toBeTruthy() // the <Show> inside still reacts

        // ESCAPE closes, the element is back in its bar position, focus is on the trigger.
        await userEvent.keyboard('{Escape}')
        await waitFor(() => expect(document.body.querySelector('[data-popover]')).toBeNull())
        expect(dark.parentElement).toBe(home)
        expect(bar.contains(dark)).toBe(true)
        expect(darkButton.getAttribute('aria-pressed')).toBe('true')
        expect(shown(dark)).toBe(false) // still dropped from the bar
        expect(document.activeElement).toBe(trigger)

        // OUTSIDE PRESS closes.
        panel = await open()
        await userEvent.click(document.body)
        await waitFor(() => expect(document.body.querySelector('[data-popover]')).toBeNull())
        expect(dark.parentElement).toBe(home)

        // RESIZE closes.
        panel = await open()
        window.dispatchEvent(new Event('resize'))
        await waitFor(() => expect(document.body.querySelector('[data-popover]')).toBeNull())
        expect(dark.parentElement).toBe(home)
        expect(bar.contains(dark)).toBe(true)
    },
}

/** A small bar at an ordinary narrow width: everything fits, so no [≡]. */
export const SmallBarNarrowFits: Story = {
    render: () => (
        <Frame w="400px">
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                config={
                    <>
                        <IconButton data-bar-drop="4" icon="PanelRight" label="Categories" />
                        <IconButton data-bar-drop="3" icon="Settings" label="Options" />
                    </>
                }
                actions={<IconButton icon="Plus" label="New" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        await new Promise(r =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(null))),
        )
        expect(bar.querySelectorAll('[data-bar-hidden]').length).toBe(0)
        expect(within(bar).queryByLabelText('More controls')).toBeNull()
        expect(shown(within(bar).getByLabelText('Categories'))).toBe(true)
        expect(shown(within(bar).getByLabelText('Options'))).toBe(true)
    },
}

/** The same small bar truly squeezed: its droppable control cannot fit, so it is hidden and [≡]
 *  appears. */
export const SmallBarSqueezed: Story = {
    render: () => (
        <Frame w="100px">
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                config={
                    <>
                        <IconButton data-bar-drop="4" icon="PanelRight" label="Categories" />
                        <IconButton data-bar-drop="3" icon="Settings" label="Options" />
                    </>
                }
                actions={<IconButton icon="Plus" label="New" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const trigger = await waitFor(() => within(bar).getByLabelText('More controls'))
        expect(shown(trigger)).toBe(true)
        expect(bar.querySelectorAll('[data-bar-hidden]').length).toBeGreaterThan(0)
        expect(shown(within(bar).getByLabelText('Categories'))).toBe(false)
        await userEvent.click(trigger)
        const panel = await waitFor(() => {
            const p = document.body.querySelector<HTMLElement>('[data-popover]')
            expect(p).toBeTruthy()
            return p!
        })
        expect(shown(within(panel).getByLabelText('Categories'))).toBe(true)
        await userEvent.keyboard('{Escape}')
    },
}

/** The [≡] panel LEFT OPEN, for the eye and for measurement: each row is a muted lowercase label on
 *  the left and the live control on the right, all controls starting on ONE column, icons at the
 *  bar's icon box (same height as a bar icon) and the panel padded on the spacing tokens. */
export const ManyControlsNarrowPanelOpen: Story = {
    render: () => <ManyControlsBar w="300px" sm />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const trigger = await waitFor(() => within(bar).getByLabelText('More controls'))
        await userEvent.click(trigger)
        const panel = await waitFor(() => {
            const p = document.body.querySelector<HTMLElement>('[data-popover]')
            expect(p).toBeTruthy()
            return p!
        })
        const rows = [...panel.querySelectorAll<HTMLElement>('[data-bar-menu-label]')]
        expect(rows.length, 'dropped elements in the panel').toBeGreaterThan(1)
        // One column: every dropped element starts at the same x.
        const lefts = rows.map(r => Math.round(r.getBoundingClientRect().left))
        expect(new Set(lefts).size, `controls column ${JSON.stringify(lefts)}`).toBe(1)
        // Labels are one column too, left of the controls, muted, lowercase.
        const labels = rows.map(r => within(panel).getByText(r.getAttribute('data-bar-menu-label')!))
        const labelLefts = labels.map(l => Math.round(l.getBoundingClientRect().left))
        expect(new Set(labelLefts).size, `labels column ${JSON.stringify(labelLefts)}`).toBe(1)
        expect(labelLefts[0]!).toBeLessThan(lefts[0]!)
        for (const l of labels) expect(l.textContent).toBe(l.textContent!.toLowerCase())
        // Icons at the bar's icon box: a bar icon's height is the panel icon's height.
        const dark = within(panel).getByLabelText('Dark')
        const barIcon = within(bar).getByLabelText('More controls')
        expect(dark.getBoundingClientRect().height).toBeCloseTo(barIcon.getBoundingClientRect().height, 0)
        expect(getComputedStyle(dark).fontSize).toBe(getComputedStyle(barIcon).fontSize)
        // Padding on the spacing tokens: --sp-4 above/below, --sp-5 left/right.
        const rowsBox = rows[0]!.parentElement!.parentElement!.parentElement! // slot > row > rows
        const cs = getComputedStyle(rowsBox)
        const probe = document.createElement('i')
        probe.style.cssText = 'position:absolute;visibility:hidden;width:var(--sp-5);height:var(--sp-4)'
        document.body.appendChild(probe)
        const sp5 = probe.getBoundingClientRect().width
        const sp4 = probe.getBoundingClientRect().height
        probe.remove()
        expect(parseFloat(cs.paddingLeft)).toBeCloseTo(sp5, 1)
        expect(parseFloat(cs.paddingTop)).toBeCloseTo(sp4, 1)
    },
}

/** SAFETY: a dropped element's owner may remove it (its `<Show>` flips false) while it sits in the
 *  open panel. Nothing throws, the panel's row empties out, and after close the bar holds no ghost
 *  of the removed control; when the owner shows it again the bar has exactly one. */
function UnmountBar() {
    const [on, setOn] = createSignal(true)
    return (
        <Frame w="260px">
            <ViewBar
                identity={<Crumb icon="FileText">annotated.pdf</Crumb>}
                readouts={<Text tone="muted">p. 2 / 4</Text>}
                config={
                    <>
                        <Show when={on()}>
                            <div
                                data-bar-drop="4"
                                data-bar-menu-label="dark mode"
                                data-testid="owned"
                            >
                                <div style={{ display: 'flex', 'align-items': 'center' }}>
                                <IconButton icon="Moon" label="Dark" />
                                </div>
                            </div>
                        </Show>
                        <div
                            data-bar-drop="3"
                            data-bar-menu-label="zoom"
                        >
                            <div style={{ display: 'flex', 'align-items': 'center' }}>
                            <IconButton icon="Minus" label="Zoom out" />
                            <IconButton icon="Plus" label="Zoom in" />
                            </div>
                        </div>
                    </>
                }
                actions={
                    <TextButton data-testid="unmount-toggle" onClick={() => setOn(v => !v)}>
                        toggle
                    </TextButton>
                }
            />
        </Frame>
    )
}

export const DroppedElementUnmountsWhileOpen: Story = {
    render: () => <UnmountBar />,
    play: async ({ canvasElement }) => {
        const errors: string[] = []
        // "ResizeObserver loop completed…" is the browser's benign notice that a layout pass queued
        // another observation; it is not a thrown error and the fit pass causes it by design.
        const onError = (e: ErrorEvent) => {
            if (!e.message.startsWith('ResizeObserver loop')) errors.push(e.message)
        }
        window.addEventListener('error', onError)
        try {
            const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
            const trigger = await waitFor(() => within(bar).getByLabelText('More controls'))
            await userEvent.click(trigger)
            const panel = await waitFor(() => {
                const p = document.body.querySelector<HTMLElement>('[data-popover]')
                expect(p).toBeTruthy()
                expect(within(p!).getByLabelText('Dark')).toBeTruthy()
                return p!
            })
            // The owner removes the element while it is in the panel. The press is a plain click on a
            // control outside the panel, dispatched without closing the panel.
            const toggle = within(bar).getByTestId('unmount-toggle') as HTMLElement
            toggle.click()
            await waitFor(() => expect(within(panel).queryByLabelText('Dark')).toBeNull())
            expect(errors, `no error thrown: ${JSON.stringify(errors)}`).toEqual([])
            // Close, then: the removed control is nowhere in the document.
            await userEvent.keyboard('{Escape}')
            await waitFor(() => expect(document.body.querySelector('[data-popover]')).toBeNull())
            expect(canvasElement.querySelector('[data-testid="owned"]'), 'no ghost in the bar').toBeNull()
            expect(within(document.body).queryByLabelText('Dark')).toBeNull()
            // Shown again: exactly one, and the bar refits around it.
            toggle.click()
            await waitFor(() =>
                expect(canvasElement.querySelectorAll('[data-testid="owned"]').length).toBe(1),
            )
            expect(errors).toEqual([])
        } finally {
            window.removeEventListener('error', onError)
        }
    },
}

/** The drop is a pure function of width: resizing the frame across the threshold and back
 *  (900 → 380 → 900 → 380) lands on the same hidden set each time it revisits a width, with no
 *  state left over from the previous visit. */
export const ResizeAcrossTheThresholdIsStable: Story = {
    render: () => <ManyControlsBar w="900px" />,
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector<HTMLElement>('[data-viewbar]')!
        const frame = bar.parentElement!
        const read = () => ({
            hidden: [...bar.querySelectorAll('[data-bar-hidden]')]
                .map(e => e.getAttribute('data-bar-menu-label') ?? 'region')
                .sort()
                .join(','),
            overflow: !!bar.querySelector('[data-bar-overflow]'),
        })
        const settle = async (w: number, wantOverflow: boolean) => {
            frame.style.width = `${w}px`
            await waitFor(() => expect(!!bar.querySelector('[data-bar-overflow]'), `${w}px`).toBe(wantOverflow))
            // one more frame so hidden marks written in the same fit pass are in place
            await new Promise(r => requestAnimationFrame(() => r(null)))
            return read()
        }
        const wide1 = await settle(900, false)
        const narrow1 = await settle(380, true)
        const wide2 = await settle(900, false)
        const narrow2 = await settle(380, true)
        expect(wide1.hidden, 'nothing hidden at 900px').toBe('')
        expect(narrow1.hidden, 'something hidden at 380px').not.toBe('')
        expect(wide2, '900px revisited').toEqual(wide1)
        expect(narrow2, '380px revisited').toEqual(narrow1)
        expect(bar.querySelectorAll('[data-bar-hidden]').length).toBeGreaterThan(0)
    },
}
