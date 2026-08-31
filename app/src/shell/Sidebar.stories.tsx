// Visual spec for <Sidebar> — the left column: toolbar row, "VAULT" eyebrow + file tree, and a
// "GRAPH" eyebrow + the docked graph square that collapses when a graph pane is already open.
//
// WHY THIS FILE EXISTS: 13 `.sidebar*` rules (11 moved outright, `.sidebar-logo` deleted as dead,
// and the two `.sidebar-icons .btn--icon` context rules copied — not moved, since `.btn--icon`
// itself still styles four other parents from App.css) moved from the global App.css into
// Sidebar.module.css, which HASHES every class name. A name left behind as a string literal
// still compiles and still renders, it just matches nothing — the column loses its flex layout,
// the eyebrow rows lose their height, the graph section stops collapsing to `display: none`.
// Nothing else in the repo can see that: typecheck reads no CSS, and Bun resolves `solid-js/web`
// to its server build so no unit test can mount a Solid component at all. `bench/cssBaseline.ts`
// reads computed styles off Storybook, so these stories ARE the gate — and they were recorded
// BEFORE the CSS moved, while the class names were still the pre-migration global literals. That
// ordering is the only one under which a subsequent "0 changed" means the migration preserved the
// rendering; a story first recorded after the move would have blessed whatever it happened to
// render, broken included.
//
// SLOTS, NOT PROP-DRILLING: `toolbar` and `tree` are handed finished JSX. These stories pass real
// <CommandButton>s for the toolbar slot and a plain stub div for the tree slot — Sidebar never
// learns what a command or a vault is, so no transport or fixture seam is needed at all.
//
// FIXED HEIGHT WRAPPER: the column is `display: flex; flex-direction: column; min-height: 0`, so
// an auto-height parent (Storybook's default canvas) collapses it to its content's natural size
// instead of the real app's viewport-height column. Every story wraps in `height: 600px`.
//
// THREE STORIES: `Default` — toolbar slot of three real <CommandButton>s, tree slot of a stub,
// graph section expanded. `GraphCollapsed` — the `collapsed` state class (`display: none`), the
// only story reaching it; without it the rule has zero coverage. `Hidden` — `visible: false`.
// Documents that `.sidebar.hidden` is unstyled TODAY (see the component header) so a future rule
// added for it cannot land unmeasured by this gate.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { For } from 'solid-js'
import { Sidebar } from './Sidebar'
import { CommandButton } from './CommandButton'

const noop = () => {}

const meta = {
    title: 'Shell/Sidebar',
    component: Sidebar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            height: '600px',
            width: '266px',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

const toolbar = (
    <>
        <CommandButton icon="Search" label="Search" onClick={noop} />
        <CommandButton icon="Inbox" label="Inbox" badge={2} onClick={noop} />
        <CommandButton icon="Settings" label="Settings" onClick={noop} />
    </>
)

const treeStub = (
    <div style={{ padding: '4px', color: 'var(--text-muted)' }}>
        [file tree]
    </div>
)

/** Resting state: toolbar row, a tree stub, graph section expanded (visible). */
export const Default: Story = {
    render: () => (
        <Wrap>
            <Sidebar
                visible={true}
                graphCollapsed={false}
                graphSlotRef={noop}
                toolbar={toolbar}
                tree={treeStub}
            />
        </Wrap>
    ),
}

/** The graph section's `collapsed` state class — `display: none` — reached when a tab already
 *  shows the Knowledge Graph, so the docked square would be redundant. The only story exercising
 *  it; without it the rule has zero coverage. */
export const GraphCollapsed: Story = {
    render: () => (
        <Wrap>
            <Sidebar
                visible={true}
                graphCollapsed={true}
                graphSlotRef={noop}
                toolbar={toolbar}
                tree={treeStub}
            />
        </Wrap>
    ),
}

/** `visible: false` — documents that the collapse today comes entirely from `.layout.sidebar-hidden`
 *  one level up; `.sidebar.hidden` itself carries no rule, so this story renders identically to
 *  `Default` by design (see the component header). It exists so a future `.sidebar.hidden` rule
 *  cannot land unmeasured by this gate. */
export const Hidden: Story = {
    render: () => (
        <Wrap>
            <Sidebar
                visible={false}
                graphCollapsed={false}
                graphSlotRef={noop}
                toolbar={toolbar}
                tree={treeStub}
            />
        </Wrap>
    ),
}

/** Tall tree that overflows the 600px container, so the scroller actually scrolls.
 *  Used to verify that overscroll-behavior: none is working — without it, flicking
 *  past the top or bottom bounces the tree (macOS rubber-band). */
export const Overflowing: Story = {
    render: () => {
        const tallTree = () => (
            <div>
                <For each={Array.from({ length: 80 }, (_, i) => i)}>
                    {i => <div style={{ height: '18px' }}>note-{i}.md</div>}
                </For>
            </div>
        )
        return (
            <Wrap>
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={noop}
                    toolbar={toolbar}
                    tree={tallTree()}
                />
            </Wrap>
        )
    },
}
