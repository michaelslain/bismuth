// Visual spec for <Sidebar> — the left column: toolbar row, "VAULT" eyebrow + file tree, and a
// "GRAPH" eyebrow + the docked graph square that collapses when a graph pane is already open.
//
// WHY THIS FILE EXISTS: 13 `.sidebar*` rules (11 moved outright, `.sidebar-logo` deleted as dead;
// the toolbar row now renders through `ui/IconBar`) moved from the global App.css into
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
// STORIES: `Default` — toolbar slot of three real <CommandButton>s, tree slot of a stub,
// graph section expanded. `GraphCollapsed` — the `collapsed` state class (`display: none`), the
// only story reaching it; without it the rule has zero coverage. `Hidden` — `visible: false`.
// Documents that `.sidebar.hidden` is unstyled TODAY (see the component header) so a future rule
// added for it cannot land unmeasured by this gate. `DockedGraph` — the sidebar in an app-shaped
// 266px grid track with a real <GraphFloater> placed over the graph slot, the only story where the
// sidebar's border-right can be painted over.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { For, onMount } from 'solid-js'
import sidebarStyles from './Sidebar.module.css'
import { Sidebar } from './Sidebar'
import { CommandButton } from './CommandButton'
import { GraphFloater } from './GraphFloater'
import { GraphView } from '../GraphView'
import { sampleGraphData } from '../ui/_graphFixtures'

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
            // a grid, so the <aside> stretches to the full 600px the way the app's grid cell
            // stretches it; a flex column left it content-sized with dead space below
            display: 'grid',
            'grid-template-rows': 'minmax(0, 1fr)',
        }}
    >
        {props.children as never}
    </div>
)

/** The graph area as the app paints it: a real <GraphFloater docked> snapped onto the graph slot's
 *  rect in `onMount` (what App.tsx's `placeFloater` does), filled with `--bg`. Call once per story
 *  render; pass `slotRef` to the Sidebar and render `floater` beside it. */
const useDockedGraph = (
    onSlot?: (el: HTMLDivElement) => void,
    realGraph = false,
) => {
    let slot: HTMLDivElement | undefined
    let floater: HTMLDivElement | undefined
    onMount(() => {
        if (!slot || !floater) return
        const r = slot.getBoundingClientRect()
        floater.style.top = `${r.top}px`
        floater.style.left = `${r.left}px`
        floater.style.width = `${r.width}px`
        floater.style.height = `${r.height}px`
    })
    return {
        slotRef: (el: HTMLDivElement) => {
            slot = el
            onSlot?.(el)
        },
        floater: (
            <GraphFloater docked={true} ref={el => (floater = el)}>
                {realGraph ? (
                    <GraphView
                        fill
                        mini
                        graph={sampleGraphData(8)}
                        onOpen={noop}
                        mode="2nd"
                        setMode={noop}
                        active={null}
                    />
                ) : (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: 'var(--bg)',
                        }}
                    />
                )}
            </GraphFloater>
        ),
    }
}

const toolbar = () => (
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
    render: () => {
        const dock = useDockedGraph()
        return (
            <Wrap>
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={dock.slotRef}
                    toolbar={toolbar()}
                    tree={treeStub}
                />
                {dock.floater}
            </Wrap>
        )
    },
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
                toolbar={toolbar()}
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
    render: () => {
        const dock = useDockedGraph()
        return (
            <Wrap>
                <Sidebar
                    visible={false}
                    graphCollapsed={false}
                    graphSlotRef={dock.slotRef}
                    toolbar={toolbar()}
                    tree={treeStub}
                />
                {dock.floater}
            </Wrap>
        )
    },
}

/** `side="right"` — the 1px line moves to the column's left edge. The sidebar sits flush to the
 *  canvas's RIGHT edge (an editor-coloured area fills the left), the way the app places it, so the
 *  border reads as the line between editor and sidebar. */
export const RightSide: Story = {
    render: () => {
        const dock = useDockedGraph(undefined, true)
        return (
            <div
                style={{
                    display: 'flex',
                    'justify-content': 'flex-end',
                    height: '600px',
                    width: '566px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border-soft)',
                }}
            >
                <div style={{ width: '266px', display: 'grid', 'grid-template-rows': 'minmax(0, 1fr)' }}>
                    <Sidebar
                        visible={true}
                        graphCollapsed={false}
                        graphSlotRef={dock.slotRef}
                        toolbar={toolbar()}
                        tree={treeStub}
                        side="right"
                    />
                </div>
                {dock.floater}
            </div>
        )
    },
}

/** Toolbar as the last of three sections — its hairline moves to the top. */
export const ToolbarLast: Story = {
    render: () => {
        const dock = useDockedGraph()
        return (
            <Wrap>
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={dock.slotRef}
                    toolbar={toolbar()}
                    tree={treeStub}
                    sections={['files', 'graph', 'toolbar']}
                />
                {dock.floater}
            </Wrap>
        )
    },
}

/** Graph square first, then the files, then the toolbar. The graph's hairline faces the files
 *  (its bottom edge), never the window top. */
export const GraphFirst: Story = {
    render: () => {
        const dock = useDockedGraph(el => {
            ;(window as any).__graphSlotFirst = el
        })
        return (
            <Wrap>
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={dock.slotRef}
                    toolbar={toolbar()}
                    tree={treeStub}
                    sections={['graph', 'files', 'toolbar']}
                />
                {dock.floater}
            </Wrap>
        )
    },
    play: async () => {
        const cs = getComputedStyle(
            (window as any).__graphSlotFirst as HTMLElement,
        )
        expect(cs.borderTopWidth).toBe('0px')
        expect(cs.borderBottomWidth).toBe('1px')
    },
}

/** Toolbar, then graph, then files — the toolbar's own bottom hairline is the only line above the
 *  graph, so the graph draws none on top. */
export const ToolbarThenGraph: Story = {
    render: () => {
        const dock = useDockedGraph(el => {
            ;(window as any).__graphSlotTG = el
        })
        return (
            <Wrap>
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={dock.slotRef}
                    toolbar={toolbar()}
                    tree={treeStub}
                    sections={['toolbar', 'graph', 'files']}
                />
                {dock.floater}
            </Wrap>
        )
    },
    play: async () => {
        const cs = getComputedStyle(
            (window as any).__graphSlotTG as HTMLElement,
        )
        expect(cs.borderTopWidth).toBe('0px')
        expect(cs.borderBottomWidth).toBe('1px')
    },
}

/** `graph` left out — no docked graph square. */
export const NoGraph: Story = {
    render: () => (
        <Wrap>
            <Sidebar
                visible={true}
                graphCollapsed={false}
                graphSlotRef={noop}
                toolbar={toolbar()}
                tree={treeStub}
                sections={['toolbar', 'files']}
            />
        </Wrap>
    ),
}

/** Only the file tree. */
export const FilesOnly: Story = {
    render: () => (
        <Wrap>
            <Sidebar
                visible={true}
                graphCollapsed={false}
                graphSlotRef={noop}
                toolbar={toolbar()}
                tree={treeStub}
                sections={['files']}
            />
        </Wrap>
    ),
}

/** Tall tree that overflows the 600px container, so the scroller actually scrolls.
 *  Used to verify that overscroll-behavior: none is working — without it, flicking
 *  past the top or bottom bounces the tree (macOS rubber-band). Graph section
 *  is collapsed to maximize space for the scroller. */
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
                    graphCollapsed={true}
                    graphSlotRef={noop}
                    toolbar={toolbar()}
                    tree={tallTree()}
                />
            </Wrap>
        )
    },
    play: async ({ canvasElement }) => {
        const scroller = canvasElement.querySelector(
            `.${sidebarStyles['sidebar-files']}`,
        ) as HTMLElement
        expect(scroller).not.toBeNull()
        const cs = getComputedStyle(scroller)
        expect(cs.overscrollBehavior).toBe('none')
        expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    },
}

/** The docked graph as the app lays it out: the sidebar in a `var(--sidebar-width)` grid track (the
 *  other stories' wrapper squeezes it 2px narrower than the app does), and a real <GraphFloater>
 *  snapped onto the graph slot's rect the way App.tsx's `placeFloater` does — `position: fixed`,
 *  `z-index: 2`, top/left/width/height written from `getBoundingClientRect()`. Both columns fill
 *  with `--bg`, like the graph canvas beside a note, so the sidebar's 1px `--border-soft`
 *  border-right is the only thing separating them. The floater once measured the slot at the full
 *  266px and painted over that hairline; `play` pins that it now stops at the border. */
export const DockedGraph: Story = {
    render: () => {
        let slot: HTMLDivElement | undefined
        let floater: HTMLDivElement | undefined
        onMount(() => {
            if (!slot || !floater) return
            const r = slot.getBoundingClientRect()
            floater.style.top = `${r.top}px`
            floater.style.left = `${r.left}px`
            floater.style.width = `${r.width}px`
            floater.style.height = `${r.height}px`
        })
        return (
            <div
                style={{
                    display: 'grid',
                    'grid-template-columns':
                        'var(--sidebar-width, 266px) 320px',
                    height: '600px',
                    width: 'max-content',
                    '--sidebar-w': 'var(--sidebar-width, 266px)',
                }}
            >
                <Sidebar
                    visible={true}
                    graphCollapsed={false}
                    graphSlotRef={el => (slot = el)}
                    toolbar={toolbar()}
                    tree={treeStub}
                />
                <div style={{ background: 'var(--bg)' }} />
                <GraphFloater docked={true} ref={el => (floater = el)}>
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: 'var(--bg)',
                        }}
                    />
                </GraphFloater>
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const aside = canvasElement.querySelector('aside') as HTMLElement
        const floater = canvasElement.querySelector(
            '[data-graph-floater]',
        ) as HTMLElement
        expect(aside).not.toBeNull()
        expect(floater).not.toBeNull()
        const borderX =
            aside.getBoundingClientRect().right -
            parseFloat(getComputedStyle(aside).borderRightWidth)
        expect(floater.getBoundingClientRect().width).toBeGreaterThan(0)
        expect(floater.getBoundingClientRect().right).toBeLessThanOrEqual(
            borderX,
        )
    },
}
