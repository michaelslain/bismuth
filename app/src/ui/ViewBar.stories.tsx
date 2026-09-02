// Visual spec for <ViewBar> + <Crumb> + <VBtn> — the canonical 36px view header used across
// graph/bases/calendar/flashcards. The bar takes NAMED REGION SLOTS (identity · locus · facet on
// the left, readouts · config · actions on the right), not positional children, so these stories
// compose it exactly as call sites do (see GraphView.tsx / bases/BaseView.tsx) rather than
// rendering each piece in isolation.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, within } from 'storybook/test'
import { createSignal, Show, type JSX } from 'solid-js'
import ViewBar, { Crumb, VBtn } from './ViewBar'
import { SegmentedToggle } from './SegmentedToggle'
import { IconButton } from './IconButton'
import Text from './Text'

const meta = {
    title: 'UI/ViewBar',
    parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

// ViewBar is a bare header strip (no side padding beyond its own), so give the story
// canvas a body to sit above, matching a real content view.
function Frame(props: { children: JSX.Element }) {
    return (
        <div
            style={{
                width: '640px',
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
                            <VBtn
                                icon="Settings"
                                title="Settings"
                                active={settingsOpen()}
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

/** A serif crumb title (the standalone calendar month heading shape) + a mode switcher
 *  on the far right — the Knowledge Graph header shape. */
export const SerifCrumbWithModeSwitcher: Story = {
    render: () => {
        const [mode, setMode] = createSignal('2d')
        return (
            <Frame>
                <ViewBar
                    identity={
                        <Crumb icon="Share2" serif>
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
                locus={<VBtn icon="ChevronLeft" title="Previous" />}
                facet={<VBtn title="TABLE" active />}
                readouts={<Text as="span" size="ui" tone="muted">42 rows</Text>}
                config={<VBtn icon="Settings" title="Settings" />}
                actions={<VBtn icon="Plus" title="New" />}
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const bar = canvasElement.querySelector('.viewbar')!
        // All six regions, in the documented order, split across the two groups.
        const order = [...bar.querySelectorAll('[class^="vb-"]')].map(
            e => e.className,
        )
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
            .querySelector('.vb-trail')!
            .getBoundingClientRect()
        expect(Math.round(barBox.height)).toBe(36)
        expect(Math.round(barBox.right - trailBox.right)).toBe(18) // the bar's own padding
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
        const bar = canvasElement.querySelector('.viewbar')!
        expect(bar.querySelector('.vb-lead')!.children.length).toBe(1)
        expect(bar.querySelector('.vb-trail')!.children.length).toBe(0)
        expect(bar.querySelector('.vb-identity')).not.toBeNull()
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
                            <VBtn icon="Plus" title="New" />
                        </Show>
                        <Show when={false}>
                            <VBtn icon="Settings" title="Settings" />
                        </Show>
                    </>
                }
            />
        </Frame>
    ),
    play: async ({ canvasElement }) => {
        const canvas = within(canvasElement)
        expect(canvas.getByText('Reading List')).toBeInTheDocument()
        const bar = canvasElement.querySelector('.viewbar')!
        // ZERO element children. Under a `length > 0` check this is 1 — an empty .vb-actions.
        expect(bar.querySelector('.vb-trail')!.children.length).toBe(0)
        // The leading group still renders exactly the one region that IS populated.
        const lead = bar.querySelector('.vb-lead')!
        expect(lead.children.length).toBe(1)
        expect(lead.querySelector('.vb-identity')).not.toBeNull()
        // And no region wrapper anywhere in the bar is empty.
        for (const r of bar.querySelectorAll(
            '.vb-identity, .vb-locus, .vb-facet, .vb-readouts, .vb-config, .vb-actions',
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
        const bar = canvasElement.querySelector<HTMLElement>('.viewbar')!
        // The container really is inside the tier — otherwise this story proves nothing.
        expect(bar.clientWidth).toBeLessThanOrEqual(650)
        const readouts = bar.querySelector<HTMLElement>('.vb-readouts')!
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
        const bar = canvasElement.querySelector<HTMLElement>('.viewbar')!
        expect(bar.clientWidth).toBeLessThanOrEqual(650)
        const lead = bar.querySelector<HTMLElement>('.vb-lead')!
        // Genuinely empty — no identity, locus or facet slot was passed.
        expect(lead.children.length).toBe(0)
        expect(getComputedStyle(lead).display).not.toBe('none')
        // The load-bearing consequence: the trailing group is still on the right. Measured against
        // the bar's own box, so its 18px padding is not mistaken for a gap.
        const trail = bar.querySelector<HTMLElement>('.vb-trail')!
        const barBox = bar.getBoundingClientRect()
        const trailBox = trail.getBoundingClientRect()
        expect(barBox.right - trailBox.right).toBeLessThanOrEqual(19)
        // Not merely "somewhere" — a collapsed .vb-lead would put it hard against the left padding.
        expect(trailBox.left - barBox.left).toBeGreaterThan(100)
    },
}
