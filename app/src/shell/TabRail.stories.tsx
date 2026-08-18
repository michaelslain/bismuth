// Visual spec for <TabRail> — the app's ONLY tab presentation, a right-edge vertical rail.
// Collapsed (48px) it shows just the action toolbar + tab icons; expanded (232px, via :hover /
// :focus-within) it widens leftward over the editor without reflowing it.
//
// WHY THIS FILE EXISTS: recorded BEFORE the `.tab-rail*` rules (+ `.tab-rename`, + the
// `@media (prefers-reduced-motion)` block, invisible to a `^\.`-anchored grep — Trap 6) moved from
// the global App.css into TabRail.module.css, which HASHES every class name. See the plan's THE
// RECIPE for why the recording order is load-bearing. The `play` below now queries through `styles`
// rather than bare class-name selectors, for the same reason the component itself does.
//
// SHARES ITS MODULE WITH `TabRailRow.stories.tsx` — see TabRail.tsx's header for why (eight
// hover/focus selectors span both components).
//
// TWO STORIES: `Collapsed` — resting, `.tab-rail-inner` at 46px, `.tab-rail-label` at
// `opacity: 0`. `Expanded` — a `play` that calls `.focus()` on the first row's close button, so
// `:focus-within` fires and `.tab-rail-inner` resolves to 232px with labels at `opacity: 1`. This
// is the ONLY way five of the eight reveal rules get any coverage at all — `:hover` cannot be
// posed from a story (CSS `:hover` follows the physical pointer; `userEvent.hover` dispatches
// events without moving it), but `:focus-within` follows real focus and `element.focus()` sets it.
// The width assertion makes the story fail loudly if the mechanism stops working, rather than
// quietly recording a collapsed rail as if it were expanded.
//
// UNCOVERED BY THIS INSTRUMENT: `.tab-rail-row:hover`, `.tab-rail:hover .tab-rail-row:hover .tab-x`,
// `.tab-rail:hover .tab-rail-row:hover .tab-pin` — real-pointer-only, rest on
// `bench/moduleClassCheck.ts` alone to prove the class names still reach the DOM.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { TabRail } from './TabRail'
import { TabRailRow } from './TabRailRow'
import { CommandButton } from './CommandButton'
import styles from './TabRail.module.css'

const noop = () => {}

const meta = {
    title: 'Shell/TabRail',
    component: TabRail,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TabRail>

export default meta
type Story = StoryObj<typeof meta>

// In the real app `.tab-rail` is a CSS-grid item of `.layout` (App.css `.layout { display: grid;
// height: 100%; }`), and grid items stretch to fill BOTH the row height and column width by default
// (`align-items`/`justify-items: stretch`) — so `.tab-rail` always has real height and width, and its
// absolutely-positioned `.tab-rail-inner` (top:0;right:0;bottom:0) resolves against that box. A plain
// block `Wrap` does NOT stretch a block child to fill it, so `.tab-rail` collapsed to 0 height here
// (no in-flow content — its only child is `position: absolute`), which made `.tab-rail-inner`'s
// `top:0;bottom:0` resolve to a 0px-tall box: everything inside rendered with real text and 21 DOM
// elements while painting nothing. (`display: flex` was tried first and made it worse: a flex item's
// `width: auto` shrinks to its intrinsic content width — 0, same reason — rather than stretching, so
// `.tab-rail` gained height but landed at width 0 and its `right: 0`-anchored inner rendered almost
// entirely off-canvas to the left.) `display: grid` on Wrap stretches its single child in both axes,
// the same way `.layout`'s grid does in the app — a STORY fix, not a component/CSS one; `.tab-rail`'s
// own rules never assume a particular parent display mode.
const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            display: 'grid',
            height: '500px',
            position: 'relative',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

const rows = (
    <>
        <TabRailRow
            label="design-notes.md"
            icon="File"
            active={true}
            pinned={false}
            dragging={false}
            renaming={false}
            onActivate={noop}
            onPointerDown={noop}
            onAuxClick={noop}
            onDblClick={noop}
            onContextMenu={noop}
            onClose={noop}
            onUnpin={noop}
            onCommitRename={noop}
            onCancelRename={noop}
        />
        <TabRailRow
            label="Knowledge Graph"
            icon="Share2"
            active={false}
            pinned={true}
            dragging={false}
            renaming={false}
            onActivate={noop}
            onPointerDown={noop}
            onAuxClick={noop}
            onDblClick={noop}
            onContextMenu={noop}
            onClose={noop}
            onUnpin={noop}
            onCommitRename={noop}
            onCancelRename={noop}
        />
    </>
)

const actions = (
    <>
        <CommandButton icon="Plus" label="New tab" onClick={noop} />
        <CommandButton
            icon="TerminalSquare"
            label="New terminal"
            onClick={noop}
        />
    </>
)

/** Resting state: collapsed to 48px, labels hidden. */
export const Collapsed: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions}>{rows}</TabRail>
        </Wrap>
    ),
}

/** `:focus-within` — a `play` focuses the first row's close button, expanding the rail to 232px
 *  with labels visible. Asserted directly so the story fails loudly if the mechanism breaks. */
export const Expanded: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions}>{rows}</TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const closeBtn = canvasElement.querySelector(`.${styles['tab-x']}`)
        if (!(closeBtn instanceof HTMLElement))
            throw new Error('close button not found')
        closeBtn.focus()
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        await expect(getComputedStyle(inner).width).toBe('232px')
    },
}
