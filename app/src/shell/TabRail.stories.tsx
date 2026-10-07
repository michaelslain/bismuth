// Visual spec for <TabRail> — the app's ONLY tab presentation, a right-edge vertical rail.
// Collapsed (46px, `--rail-w`) it shows just the action toolbar + tab icons; expanded (232px, via
// :hover / :focus-within / the Alt+Shift+S pin) it widens leftward over the editor without
// reflowing it. (This header said 48px for a while; nothing anywhere is 48 — shell/AppFrame.module.css
// sets `.layout[data-has-rail] { --rail-w: 46px }` and `.tab-rail-inner` hardcodes the
// same 46.)
//
// WHY THIS FILE EXISTS: recorded BEFORE the `.tab-rail*` rules (+ `.tab-rename`, + the
// `@media (prefers-reduced-motion)` block, invisible to a `^\.`-anchored grep — Trap 6) moved from
// the global App.css into TabRail.module.css, which HASHES every class name. See the plan's THE
// RECIPE for why the recording order is load-bearing. The `play` below now queries through `styles`
// rather than bare class-name selectors, for the same reason the component itself does.
//
// ONE MODULE, THREE DATA HOOKS: `.tab-rail-inner`/`.tab-rail-actions` come from `styles`
// (`TabRail.module.css`). The row's own parts are reached through `data-tab-rail-icon`,
// `data-tab-rail-label` and `data-tab-rail-close` (set in TabRailRow.tsx), NOT by importing
// `TabRailRow.module.css` — that stylesheet has exactly one importer, the row.
//
// THREE STORIES: `Collapsed` — resting, `.tab-rail-inner` at 46px, `.tab-rail-label` at
// `visibility: hidden` + zero width (not merely `opacity: 0` — see TabRailRow.module.css's header
// for why a flex-shrunk label needed zeroing out and hiding, not just fading, to stop a ~1px
// sliver rendering, and why `visibility` rather than `display: none` is what keeps the opacity
// transition able to run on reveal). Its own `play` proves that: zero labels with a nonzero
// `offsetWidth`, icons unaffected.
// `Expanded` — a `play` that calls `.focus()` on the first row's close button, so
// `:focus-within` fires and `.tab-rail-inner` resolves to 232px with labels at `opacity: 1`. This
// is the ONLY way five of the eight reveal rules get any coverage at all — `:hover` cannot be
// posed from a story (CSS `:hover` follows the physical pointer; `userEvent.hover` dispatches
// events without moving it), but `:focus-within` follows real focus and `element.focus()` sets it.
// The width assertion makes the story fail loudly if the mechanism stops working, rather than
// quietly recording a collapsed rail as if it were expanded.
//
// THE WIDTH ASSERTION MUST BE POLLED, and this is the whole reason `Expanded` needs `waitFor` while
// `Pinned` below does not. `.tab-rail-inner` carries `transition: width 0.22s var(--ease)`, so
// `:focus-within` does not SET 232px — it starts an animation towards it. Reading
// `getComputedStyle(inner).width` on the line after `.focus()` samples the transition's start value,
// i.e. the collapsed 46px, and `expect(...).toBe(...)` on a plain string never retries. Measured in
// a real (non-reduced-motion) Chrome: t=0 → 46px, t=30ms → 149.9px, t=150ms → 230.7px, t=300ms →
// 232px, with `.tab-rail:focus-within` matching from t=0 throughout. It measures 232px under
// `bench/probeStory.ts` for the same reason it read red under `bench/playCheck.ts`: probeStory
// passes `--force-prefers-reduced-motion` (which the `@media` block at the top of
// TabRail.module.css answers with `transition: none`, so the width lands instantly), and playCheck
// deliberately does not. `Pinned` is unaffected either way, because its class is present at first
// paint and there is no start value to transition FROM. `waitFor` polls the SAME 232px — it does
// not relax the number.
//
// UNCOVERED BY THIS INSTRUMENT: `.tab-rail-row:hover`, `.tab-rail:hover .tab-rail-row:hover .tab-x`,
// `.tab-rail:hover .tab-rail-row:hover .tab-pin` — real-pointer-only, rest on
// `bench/moduleClassCheck.ts` alone to prove the class names still reach the DOM.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { TabRail } from './TabRail'
import { TabRailRow } from './TabRailRow'
import { CommandButton } from './CommandButton'
import EdgeHandle from './EdgeHandle'
import { dragWidth } from '../edgeResize'
import { createSignal } from 'solid-js'
import styles from './TabRail.module.css'

const noop = () => {}

/** The x of an element's centre. The action toolbar and the tab rows below it share ONE icon axis. */
const centreX = (el: Element) => {
    const r = el.getBoundingClientRect()
    return r.left + r.width / 2
}

/** The first action button's glyph and the first tab row's icon — which must land on the same x. */
const iconAxis = (root: HTMLElement) => {
    const glyph = root.querySelector('[role="toolbar"] button svg')
    const icon = root.querySelector('[data-tab-rail-icon]')
    if (!glyph || !icon) throw new Error('action glyph or tab icon not found')
    return [centreX(glyph), centreX(icon)]
}

/** A box-shadow token as the browser resolves it — the string a computed `box-shadow` reports. */
const shadowOf = (token: string) => {
    const probe = document.createElement('div')
    probe.style.boxShadow = `var(${token})`
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).boxShadow
    probe.remove()
    return resolved
}

const meta = {
    title: 'Shell/TabRail',
    component: TabRail,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof TabRail>

export default meta
type Story = StoryObj<typeof meta>

// In the real app `.tab-rail` is a CSS-grid item of `.layout` (AppFrame.module.css:
// `.layout { display: grid; height: 100%; }`), and grid items stretch to fill BOTH the row height
// and column width by default
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

const actions = () => (
    <>
        <CommandButton icon="Plus" label="New tab" onClick={noop} />
        <CommandButton
            icon="SquareTerminal"
            label="New terminal"
            onClick={noop}
        />
    </>
)

// A badge-free THIRD action, for `PinnedThreeActions` below — none of `Collapsed`/`Expanded`/
// `Pinned` render three buttons in a row, so there is no coverage of a three-wide action bar at
// all (toolbar-iconbar plan, Task 3).
const threeActions = () => (
    <>
        <CommandButton icon="Plus" label="New tab" onClick={noop} />
        <CommandButton
            icon="SquareTerminal"
            label="New terminal"
            onClick={noop}
        />
        <CommandButton icon="MessageSquare" label="New chat" onClick={noop} />
    </>
)

/** Resting state: collapsed to 46px, labels hidden — not squeezed. `play` proves each row's
 *  `.tab-rail-label` is both invisible (`visibility: hidden`) and zero-width (`offsetWidth` 0)
 *  rather than merely faded to `opacity: 0`, which a flex-shrunk label still rendered as a
 *  ~1px-wide sliver in the DOM (TabRailRow.module.css's header). The icon stays a real, non-zero
 *  box either way. */
export const Collapsed: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()}>{rows}</TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const labels = canvasElement.querySelectorAll(
            '[data-tab-rail-label]',
        )
        expect(labels.length).toBe(2)
        for (const label of labels) {
            if (!(label instanceof HTMLElement))
                throw new Error('.tab-rail-label not an HTMLElement')
            expect(getComputedStyle(label).visibility).toBe('hidden')
            expect(label.offsetWidth).toBe(0)
        }
        const icons = canvasElement.querySelectorAll(
            '[data-tab-rail-icon]',
        )
        expect(icons.length).toBe(2)
        for (const icon of icons) {
            if (!(icon instanceof HTMLElement))
                throw new Error('.tab-rail-icon not an HTMLElement')
            expect(icon.offsetWidth).toBeGreaterThan(0)
        }
        // ONE ICON AXIS: the band's own padding (padBlock, no hand-written inset) puts the action glyphs
        // exactly where the tab icons are.
        const [glyph, icon] = iconAxis(canvasElement)
        expect(glyph).toBe(icon)
    },
}

/** `:focus-within` — a `play` focuses the first row's close button, expanding the rail to 232px
 *  with labels visible. Asserted (polled through the 0.22s width transition — see the header) so
 *  the story fails loudly if the mechanism breaks. */
export const Expanded: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()}>{rows}</TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const closeBtn = canvasElement.querySelector('[data-tab-rail-close]')
        if (!(closeBtn instanceof HTMLElement))
            throw new Error('close button not found')
        closeBtn.focus()
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        // `:focus-within` matches immediately; the 0.22s width transition it triggers does not.
        // Poll for the finished 232px rather than sampling the animation's 46px start value.
        await waitFor(() => expect(getComputedStyle(inner).width).toBe('232px'))
        // The flyout of a RIGHT-edge rail carries the mirrored lift, so its depth cue falls inside the
        // window instead of off its right edge — and that is a different shadow from the plain --lift.
        await waitFor(() =>
            expect(getComputedStyle(inner).boxShadow).toBe(shadowOf('--lift-start')),
        )
        expect(shadowOf('--lift-start')).not.toBe(shadowOf('--lift'))
        const labels = canvasElement.querySelectorAll(
            '[data-tab-rail-label]',
        )
        expect(labels.length).toBe(2)
        for (const label of labels) {
            if (!(label instanceof HTMLElement))
                throw new Error('.tab-rail-label not an HTMLElement')
            expect(label.offsetWidth).toBeGreaterThan(0)
            expect(getComputedStyle(label).opacity).toBe('1')
        }
    },
}

/** PINNED (Alt+Shift+S / the "Toggle tab rail" command) — held open with no pointer on it and
 *  nothing focused inside it, which is the whole point: `Expanded` above only reaches 232px
 *  because its `play` focuses a close button. Asserts the width the same way, plus the two things
 *  that distinguish pinned from hovered: the action toolbar left-aligns to match the tab rows
 *  under it (centred is correct only for the 46px strip), and the lift shadow is dropped, since a
 *  pinned rail is part of the layout rather than something temporarily covering the editor. */
export const Pinned: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()} pinned>
                {rows}
            </TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        await expect(getComputedStyle(inner).width).toBe('232px')
        await expect(getComputedStyle(inner).boxShadow).toBe('none')
        const bar = canvasElement.querySelector(
            `.${styles['tab-rail-actions']}`,
        )
        if (!(bar instanceof HTMLElement))
            throw new Error('.tab-rail-actions not found')
        await expect(getComputedStyle(bar).justifyContent).toBe('flex-start')
        const labels = canvasElement.querySelectorAll(
            '[data-tab-rail-label]',
        )
        expect(labels.length).toBe(2)
        for (const label of labels) {
            if (!(label instanceof HTMLElement))
                throw new Error('.tab-rail-label not an HTMLElement')
            expect(label.offsetWidth).toBeGreaterThan(0)
            expect(getComputedStyle(label).opacity).toBe('1')
        }
    },
}

/** PINNED with a badge-free THREE-button action row, left-aligned same as `Pinned` above — the
 *  one story in this file proving the action bar's reveal layout still holds with three buttons,
 *  not just two. */
export const PinnedThreeActions: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={threeActions()} pinned>
                {rows}
            </TabRail>
        </Wrap>
    ),
}

/** The rail with its EDGE HANDLE wired the way App.tsx wires it, on REAL state: drag the left line
 *  to set the open width (`--tab-rail-width`, the schema's 160–480 range), click it — or the `‹`
 *  chevron that springs out at its middle — to pin, and again (`›`) to unpin. Unpinned, the rail
 *  still opens on hover, and the handle rides its edge out. The `play` focuses the handle (CSS
 *  `:hover` cannot be posed) and proves the strip stands flush against the surface's left border,
 *  where the line you grab is the line you see. */
export const WithEdge: Story = {
    render: () => {
        const [pinned, setPinned] = createSignal(true)
        const [width, setWidth] = createSignal(232)
        let start = 0
        // The APP'S grid, not `Wrap`: an editor column plus the rail's own column, 46px collapsed or
        // the open width pinned (AppFrame.module.css via data attributes). In `Wrap` the rail's root fills
        // the whole frame, so the pointer anywhere in the story is "on the rail" and an unpin can
        // never be seen to close it.
        return (
            <div
                style={{
                    '--tab-rail-width': `${width()}px`,
                    display: 'grid',
                    'grid-template-columns': `1fr ${pinned() ? width() : 46}px`,
                    height: '500px',
                    border: '1px solid var(--border-soft)',
                    background: 'var(--bg)',
                }}
            >
                <div />
                <TabRail
                    actions={actions()}
                    pinned={pinned()}
                    edge={
                        <EdgeHandle
                            panel="tab rail"
                            edge="right"
                            open={pinned()}
                            combo="Alt+Shift+S"
                            onResizeStart={() => (start = width())}
                            onResize={dx =>
                                setWidth(
                                    dragWidth('tabRailWidth', start, dx, -1),
                                )
                            }
                            onActivate={() => setPinned(v => !v)}
                        />
                    }
                >
                    {rows}
                </TabRail>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        const edge = canvasElement.querySelector('[data-edge-handle]')
        if (!(inner instanceof HTMLElement) || !(edge instanceof HTMLElement))
            throw new Error('rail surface or edge handle not found')
        await expect(getComputedStyle(inner).width).toBe('232px')
        await waitFor(() =>
            expect(Math.round(edge.getBoundingClientRect().right)).toBe(
                Math.round(inner.getBoundingClientRect().left),
            ),
        )
        edge.focus()
        const chevron = canvasElement.querySelector('[data-edge-button]')!
        await waitFor(() =>
            expect(getComputedStyle(chevron).visibility).toBe('visible'),
        )
    },
}

// LEFT RAIL — `side="left"`. The mirror image: surface anchored left, hairline on its right, the
// flyout widening rightward with `--lift`, the edge strip on the right line.

/** Resting left rail: 46px, border on the RIGHT, anchored to the frame's left edge. `play` proves the
 *  anchor and the border side, and that the icon centre sits 22px in from the surface's outer left edge — the exact
 *  x a right rail's icons sit at, so the column does not shift when the rail changes side. */
export const CollapsedLeft: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()} side="left">
                {rows}
            </TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        const cs = getComputedStyle(inner)
        expect(cs.width).toBe('46px')
        expect(cs.borderRightWidth).toBe('1px')
        expect(cs.borderLeftWidth).toBe('0px')
        const box = inner.getBoundingClientRect()
        const icon = canvasElement.querySelector(
            '[data-tab-rail-icon]',
        )
        if (!(icon instanceof HTMLElement))
            throw new Error('.tab-rail-icon not found')
        const r = icon.getBoundingClientRect()
        expect(Math.round(r.left + r.width / 2 - box.left)).toBe(22)
        // The left rail's actions ride Band's `inset="rail"`; they must still share the rows' axis.
        const [glyph, rowIcon] = iconAxis(canvasElement)
        expect(glyph).toBe(rowIcon)
    },
}

/** `:focus-within` on a left rail — widens RIGHTWARD to 232px carrying the lift shadow. */
export const ExpandedLeft: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()} side="left">
                {rows}
            </TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const closeBtn = canvasElement.querySelector('[data-tab-rail-close]')
        if (!(closeBtn instanceof HTMLElement))
            throw new Error('close button not found')
        closeBtn.focus()
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        await waitFor(() => expect(getComputedStyle(inner).width).toBe('232px'))
        // A LEFT rail widens rightward, so it keeps the plain --lift (not the mirrored one).
        await waitFor(() =>
            expect(getComputedStyle(inner).boxShadow).toBe(shadowOf('--lift')),
        )
        expect(Math.round(inner.getBoundingClientRect().left)).toBe(
            Math.round(
                (inner.parentElement as HTMLElement).getBoundingClientRect()
                    .left,
            ),
        )
    },
}

/** PINNED left rail — 232px, no lift, labels revealed. */
export const PinnedLeft: Story = {
    render: () => (
        <Wrap>
            <TabRail actions={actions()} side="left" pinned>
                {rows}
            </TabRail>
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        if (!(inner instanceof HTMLElement))
            throw new Error('.tab-rail-inner not found')
        await expect(getComputedStyle(inner).width).toBe('232px')
        await expect(getComputedStyle(inner).boxShadow).toBe('none')
    },
}

/** The left rail with its edge handle, on real state: the strip stands flush against the surface's
 *  RIGHT border, the chevron springs out rightward, `›` pins and `‹` unpins. */
export const WithEdgeLeft: Story = {
    render: () => {
        const [pinned, setPinned] = createSignal(true)
        const [width, setWidth] = createSignal(232)
        let start = 0
        return (
            <div
                style={{
                    '--tab-rail-width': `${width()}px`,
                    display: 'grid',
                    'grid-template-columns': `${pinned() ? width() : 46}px 1fr`,
                    height: '500px',
                    border: '1px solid var(--border-soft)',
                    background: 'var(--bg)',
                }}
            >
                <TabRail
                    actions={actions()}
                    side="left"
                    pinned={pinned()}
                    edge={
                        <EdgeHandle
                            panel="tab rail"
                            edge="left"
                            open={pinned()}
                            combo="Alt+Shift+S"
                            onResizeStart={() => (start = width())}
                            onResize={dx =>
                                setWidth(dragWidth('tabRailWidth', start, dx, 1))
                            }
                            onActivate={() => setPinned(v => !v)}
                        />
                    }
                >
                    {rows}
                </TabRail>
                <div />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const inner = canvasElement.querySelector(
            `.${styles['tab-rail-inner']}`,
        )
        const edge = canvasElement.querySelector('[data-edge-handle]')
        if (!(inner instanceof HTMLElement) || !(edge instanceof HTMLElement))
            throw new Error('rail surface or edge handle not found')
        await expect(getComputedStyle(inner).width).toBe('232px')
        await waitFor(() =>
            expect(Math.round(edge.getBoundingClientRect().left)).toBe(
                Math.round(inner.getBoundingClientRect().right),
            ),
        )
        edge.focus()
        const chevron = canvasElement.querySelector('[data-edge-button]')!
        await waitFor(() =>
            expect(getComputedStyle(chevron).visibility).toBe('visible'),
        )
    },
}
