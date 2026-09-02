// Visual spec for <AppFrame> — the outermost shell: top strip, sidebar/editor/rail/graph grid,
// status bar. Every slot below is a labelled colour-blocked stub div rather than a real Sidebar/
// EditorPane/etc — AppFrame itself never learns what those things are, only that it has eight
// JSX slots to place (see the component header for why that keeps this story trivial).
//
// WHY THIS FILE EXISTS: recorded BEFORE `.app-shell`/`.layout` + its three state classes
// (`sidebar-hidden`/`switcher-active`/`has-rail`) move from the global App.css into
// AppFrame.module.css, plus the `@media (prefers-reduced-motion)` block at App.css:113 (invisible
// to a `^\.`-anchored grep — Trap 6). See the plan's THE RECIPE for why the recording order is
// load-bearing.
//
// SIX STORIES — the ONLY coverage the grid template will ever have; without them a broken
// `grid-template-columns` ships green. `Default` — sidebar visible, rail present, rail unpinned
// (asserts `--rail-w: 46px`). `SidebarHidden` — `.layout.sidebar-hidden`, the highest-consequence
// Trap-1 instance in the whole plan (a missed hash means the sidebar never hides — see
// AppFrame.tsx's header). `SwitcherActive` — both the sidebar AND rail tracks collapse to 0 in
// lockstep (asserts `--rail-w: 0px`). `NoRail` — `hasRail={false}`, a state the real app never
// actually reaches today (App.tsx always passes `true`) but the prop exists to preserve, so this
// is the only story proving the grid still degrades sanely without it. `RailPinned` — queue item 2:
// pinning the rail must reserve the full 232px in the grid, not just widen the overlay (asserts
// `--rail-w: 232px` AND that the grid track followed it). `RailPinnedUnderSwitcher` — pinned AND
// taken over at once, the one interaction `:not(.switcher-active)` exists for (asserts `--rail-w:
// 0px`). `Default`, `SwitcherActive` and `RailPinnedUnderSwitcher` now ASSERT rather than merely
// render — they describe currently-correct behaviour a future rule change could break.
//
// WHY `waitFor`, even though nothing below is actually caught mid-transition: `.layout` carries
// `transition: --rail-w 0.26s var(--ease)` (App.css), so a synchronous read is the wrong default
// whenever a transitioning custom property is being asserted — defensive practice, cheap to keep.
// But do not cite these four play functions as proof `waitFor` is catching a live interpolation
// here: each story mounts with `railPinned` already fixed, so there is no PRIOR state for the
// transition to animate FROM, and `--rail-w` reads its resting value on the very first frame the
// element exists. The case that actually exercises a post-mount transition is
// `shell-tabrail--expanded`'s hover interaction — see bench/chromeSession.ts's header, which cites
// that exact story as the reason playCheck.ts runs real, un-forced-motion Chrome for interaction
// assertions in the first place.
//
// EXPLICIT-HEIGHT WRAPPER: `.app-shell` is `height: 100%`, and Storybook's default `layout:
// "centered"` canvas has no intrinsic height, so `.app-shell` would collapse to zero. Uses
// `parameters: { layout: "fullscreen" }` + a `height: 100vh` wrapper instead.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { AppFrame } from './AppFrame'

// Every stub background is one of the theme's opaque swatches EXCEPT `floater`, whose real
// counterpart (`.graph-floater`) is transparent where its canvas has no glow. A fixed `--bg` text
// colour reads fine against an opaque accent/faint/border fill, but against a transparent stub it
// shows through to the page's own `--bg` — same colour as the text, so it renders invisible. Use
// `--fg` (the page's own foreground) whenever the stub itself contributes no background.
const Stub = (props: { label: string; color: string }) => (
    <div
        style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            height: '100%',
            width: '100%',
            background: props.color,
            color: props.color === 'transparent' ? 'var(--fg)' : 'var(--bg)',
            'font-size': 'var(--fs-ui)',
        }}
    >
        {props.label}
    </div>
)

const slots = {
    topStrip: <Stub label="top strip" color="var(--accent)" />,
    sidebar: <Stub label="sidebar" color="var(--faint)" />,
    main: <Stub label="main" color="var(--border)" />,
    rail: <Stub label="rail" color="var(--faint)" />,
    floater: <Stub label="floater" color="transparent" />,
    overlays: <></>,
    modals: <></>,
    statusBar: <Stub label="status bar" color="var(--accent)" />,
}

const meta = {
    title: 'Shell/AppFrame',
    component: AppFrame,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppFrame>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div style={{ height: '100vh' }}>{props.children as never}</div>
)

/** Resting state: sidebar visible, rail present, switcher inactive, rail unpinned. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={false}
                switcherActive={false}
                hasRail={true}
                railPinned={false}
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('.layout') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('46px'),
        )
    },
}

/** `.layout.sidebar-hidden` — collapses `--sidebar-w` to 0. The highest-consequence Trap-1
 *  instance in the plan: a missed hash here means the sidebar never hides. */
export const SidebarHidden: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={true}
                switcherActive={false}
                hasRail={true}
                railPinned={false}
            />
        </Wrap>
    ),
}

/** `.layout.switcher-active` — both the sidebar and rail grid tracks collapse to 0 in lockstep
 *  with the Cmd+O quick switcher taking over the whole window. */
export const SwitcherActive: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={true}
                switcherActive={true}
                hasRail={true}
                railPinned={false}
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('.layout') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('0px'),
        )
    },
}

/** `hasRail={false}` — a state the shipped app never actually reaches today (App.tsx always
 *  passes `true`), but the prop is real, so this is the only story proving the grid still
 *  degrades sanely without `.layout.has-rail`. */
export const NoRail: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={false}
                switcherActive={false}
                hasRail={false}
                railPinned={false}
            />
        </Wrap>
    ),
}

/** THE BUG THIS PINS (queue item 2, 2026-09-01, user-reported as "when the sidebar is permanently
 *  out, it covers the right side of the note"). Pinning widened an absolutely-positioned overlay
 *  from 46px to 232px while the grid kept reserving 46px, so 186px of opaque rail sat on top of the
 *  note.
 *  This story CANNOT stand alone: a stylesheet that reserved 232px unconditionally would satisfy it
 *  while breaking the hover flyout. `Default`'s 46px assertion above is the other half of the pair,
 *  and `SwitcherActive`'s 0px assertion is what proves the takeover still wins. */
export const RailPinned: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={false}
                switcherActive={false}
                hasRail={true}
                railPinned={true}
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('.layout') as HTMLElement
        expect(layout).toBeTruthy()
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('232px'),
        )
        // …and the reserved TRACK actually followed the variable. Asserting only the custom property
        // would pass against a `grid-template-columns` that had stopped referencing it.
        const cols = getComputedStyle(layout).gridTemplateColumns.split(' ')
        expect(parseFloat(cols[cols.length - 1])).toBeCloseTo(232, 0)
    },
}

/** Pinned AND taken over. `.layout.has-rail.rail-pinned:not(.switcher-active)` is written the way it
 *  is precisely so this case has one answer regardless of rule order; without a story it would be
 *  the state nobody checked. */
export const RailPinnedUnderSwitcher: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={true}
                switcherActive={true}
                hasRail={true}
                railPinned={true}
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const layout = canvasElement.querySelector('.layout') as HTMLElement
        await waitFor(() =>
            expect(getComputedStyle(layout).getPropertyValue('--rail-w').trim()).toBe('0px'),
        )
    },
}
