// Visual spec for <BarLabel> and the collapse ladder it opts into — the shared narrow-pane
// behaviour every view bar now gets by TAGGING controls instead of writing container queries.
//
// WIDTH IS THE STORY DIMENSION, and it has to live in the story rather than in the probe command.
// `.viewbar` is a `container-type: inline-size` container, so the tiers key off the BAR's width,
// not the window's — bench/probeStory.ts renders at a hardcoded 1280x900 viewport and has no
// --width flag, and Storybook's viewport addon cannot move a container query either. So each tier
// gets its own fixed-width story, the way graph/GraphView.stories.tsx's MiniLocal pins 266x305.
//
// Handles are `data-testid`, which is TEST-ONLY: nothing in production CSS or JS reads one. The
// ladder itself reads `data-bar-label` / `data-bar-abbr` / `data-bar-drop`, which are runtime
// hooks — the two forms mean different things and are not interchangeable.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import type { JSX } from 'solid-js'
import ViewBar, { Crumb, VBtn } from './ViewBar'
import BarLabel from './BarLabel'

const meta = {
    title: 'UI/BarLabel',
    component: BarLabel,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof BarLabel>

export default meta
type Story = StoryObj<typeof meta>

/** One bar, one pinned width. Every tier story renders exactly this, so a difference between two
 *  of them can only be the width. */
function Bar(props: { width: number }): JSX.Element {
    return (
        <div style={{ width: `${props.width}px`, 'max-width': 'none' }}>
            <ViewBar
                identity={<Crumb icon="Table">Reading List</Crumb>}
                locus={
                    <VBtn
                        icon="Calendar"
                        title="Jump to today"
                        data-testid="late-btn"
                    >
                        <BarLabel long="TODAY" drop="late" />
                    </VBtn>
                }
                facet={
                    <VBtn title="Month" active data-testid="abbr-btn">
                        <BarLabel long="MONTH" short="M" />
                    </VBtn>
                }
                config={
                    <VBtn
                        icon="Tag"
                        title="Categories"
                        data-bar-drop="1"
                        data-testid="drop1-btn"
                    >
                        <BarLabel long="CATEGORIES" drop="early" />
                    </VBtn>
                }
                actions={
                    <VBtn icon="Plus" title="New" data-testid="action-btn">
                        <BarLabel long="EVENT" drop="early" />
                    </VBtn>
                }
            />
        </div>
    )
}

const shown = (el: Element | null) =>
    !!el && !!(el as HTMLElement).getClientRects().length

/** What the label inside `testid` is actually SHOWING — not what it contains. Both lengths sit in
 *  the DOM at every width, so `textContent` reads "MONTHM" forever and would grade a ladder that
 *  hides nothing as green. */
const visibleText = (root: Element, testid: string) =>
    [...root.querySelectorAll(`[data-testid="${testid}"] [data-bar-abbr]`)]
        .filter(shown)
        .map(n => n.textContent)
        .join('')

/** WIDE — 1000px. Nothing has collapsed: every word spelled out, every control present. */
export const Wide: Story = {
    render: () => <Bar width={1000} />,
    play: async ({ canvasElement }) => {
        const r = canvasElement
        expect(visibleText(r, 'drop1-btn')).toBe('CATEGORIES')
        expect(visibleText(r, 'abbr-btn')).toBe('MONTH')
        expect(visibleText(r, 'late-btn')).toBe('TODAY')
        expect(shown(r.querySelector('[data-testid="drop1-btn"]'))).toBe(true)
    },
}

/** TIER 1 — the early words go. Both buttons that lose one keep an icon that already names them
 *  and a `title`, so the label was a convenience rather than the only signal. The late word and
 *  the abbreviating one are untouched, which is the whole point of two tiers. */
export const EarlyLabelsDropped: Story = {
    render: () => <Bar width={720} />,
    play: async ({ canvasElement }) => {
        const r = canvasElement
        expect(visibleText(r, 'drop1-btn')).toBe('')
        expect(visibleText(r, 'action-btn')).toBe('')
        expect(visibleText(r, 'abbr-btn')).toBe('MONTH')
        expect(visibleText(r, 'late-btn')).toBe('TODAY')
        // The button squares up rather than keeping text padding around nothing.
        const btn = r.querySelector<HTMLElement>('[data-testid="drop1-btn"]')!
        expect(Math.round(btn.getBoundingClientRect().width)).toBe(24)
    },
}

/** TIER 2 — long labels swap for their abbreviations. Only the label carrying a `short` changes;
 *  TODAY has none and keeps its full text, which is what proves the swap is per-label rather than
 *  a blanket rule on the tier. */
export const LabelsAbbreviated: Story = {
    render: () => <Bar width={560} />,
    play: async ({ canvasElement }) => {
        const r = canvasElement
        expect(visibleText(r, 'abbr-btn')).toBe('M')
        expect(visibleText(r, 'late-btn')).toBe('TODAY')
        expect(visibleText(r, 'drop1-btn')).toBe('')
    },
}

/** TIER 3 — the late word finally goes, and TIER 4 takes the whole `data-bar-drop="1"` control
 *  with its region, so the bar stops paying a region gap for a control that is not there. */
export const LateLabelAndControlDropped: Story = {
    render: () => <Bar width={470} />,
    play: async ({ canvasElement }) => {
        const r = canvasElement
        expect(visibleText(r, 'late-btn')).toBe('')
        expect(shown(r.querySelector('[data-testid="drop1-btn"]'))).toBe(false)
        // The region wrapper goes too — otherwise `.vb-trail`'s gap survives its only child.
        expect(shown(r.querySelector('.vb-config'))).toBe(false)
        // What must NEVER drop: navigation and the primary action.
        expect(shown(r.querySelector('[data-testid="late-btn"]'))).toBe(true)
        expect(shown(r.querySelector('[data-testid="action-btn"]'))).toBe(true)
    },
}

/** BELOW THE FLOOR — a pane has no minimum width (PaneTree.module.css sets only `min-width: 0`),
 *  so this state is always reachable and has to be designed. The leading group scrolls under a
 *  masked edge, so the cut reads as "more this way" rather than as a sliced button, and the
 *  trailing group stays pinned and reachable. */
export const BelowTheFloor: Story = {
    render: () => <Bar width={200} />,
    play: async ({ canvasElement }) => {
        const lead = canvasElement.querySelector<HTMLElement>('.vb-lead')!
        expect(getComputedStyle(lead).overflowX).toBe('auto')
        expect(getComputedStyle(lead).maskImage).not.toBe('none')
        // Scrolling is only honest if there is something to scroll to.
        expect(lead.scrollWidth).toBeGreaterThan(lead.clientWidth)
        // The trailing group is never what scrolls away: + Event stays on screen.
        const action = canvasElement.querySelector<HTMLElement>(
            '[data-testid="action-btn"]',
        )!
        const bar = canvasElement.querySelector<HTMLElement>('.viewbar')!
        expect(action.getBoundingClientRect().right).toBeLessThanOrEqual(
            bar.getBoundingClientRect().right,
        )
    },
}

/** A label with no `drop` never disappears, at any width — the default, and the one every date,
 *  title and count in a bar relies on. Rendered at the narrowest tier so "never" is tested where
 *  it is hardest. It still ABBREVIATES, because it offered a `short`: the two axes are
 *  independent. */
export const UndroppableByDefault: Story = {
    render: () => (
        <div style={{ width: '260px', 'max-width': 'none' }}>
            <ViewBar
                identity={
                    <span data-testid="plain">
                        <BarLabel long="January 2026" short="Jan 26" />
                    </span>
                }
            />
        </div>
    ),
    play: async ({ canvasElement }) => {
        expect(visibleText(canvasElement, 'plain')).toBe('Jan 26')
    },
}
