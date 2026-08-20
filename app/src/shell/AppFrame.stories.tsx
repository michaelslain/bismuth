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
// FOUR STORIES — the ONLY coverage the grid template will ever have; without them a broken
// `grid-template-columns` ships green. `Default` — sidebar visible, rail present. `SidebarHidden`
// — `.layout.sidebar-hidden`, the highest-consequence Trap-1 instance in the whole plan (a missed
// hash means the sidebar never hides — see AppFrame.tsx's header). `SwitcherActive` — both the
// sidebar AND rail tracks collapse to 0 in lockstep. `NoRail` — `hasRail={false}`, a state the real
// app never actually reaches today (App.tsx always passes `true`) but the prop exists to preserve,
// so this is the only story proving the grid still degrades sanely without it.
//
// EXPLICIT-HEIGHT WRAPPER: `.app-shell` is `height: 100%`, and Storybook's default `layout:
// "centered"` canvas has no intrinsic height, so `.app-shell` would collapse to zero. Uses
// `parameters: { layout: "fullscreen" }` + a `height: 100vh` wrapper instead.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
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

/** Resting state: sidebar visible, rail present, switcher inactive. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <AppFrame
                {...slots}
                sidebarHidden={false}
                switcherActive={false}
                hasRail={true}
            />
        </Wrap>
    ),
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
            />
        </Wrap>
    ),
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
            />
        </Wrap>
    ),
}
