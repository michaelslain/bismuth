// Visual spec for <PaneLeaf> — one pane's full chrome: an optional header, its content
// (here always the graph-tab sentinel, which needs no vault/transport at all — see PaneContent),
// and the two drop affordances layered on top mid-drag.
//
// WHY THIS FILE EXISTS: `.pane-leaf`/`.pane-body` (App.css) and the family PaneHeader.stories.tsx +
// PaneDropZone.stories.tsx already cover move from the global stylesheets into the shared
// PaneTree.module.css. Recorded BEFORE that move, per THE RECIPE.
//
// NO FIXTURE SEAM NEEDED: `node.content` is the `::graph` sentinel (`GRAPH_TAB`), which
// PaneContent routes to a bare `<div data-graph-host class="full" />` placeholder with no fetch —
// the real WebGL graph lives in App's always-mounted `.graph-floater`, so no transport, vault or
// fakeTransport wiring is needed to mount a pane leaf in isolation.
//
// dragState is a plain accessor returning a static IDLE-shaped object per story; `WithActiveZone`
// and `WithReferenceCue` shape it to pose PaneDropZone's two variants (see PaneDropZone.stories.tsx
// for why no other instrument can reach them).
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { PaneLeaf } from './PaneLeaf'
import { GRAPH_TAB } from './tabIds'
import type { DragState } from './dnd/viewDrag'
import type { Leaf } from './panes'

const noop = () => {}
const noopArr = () => []

const leafNode: Leaf = { kind: 'leaf', id: 'leaf-1', content: GRAPH_TAB }

const idleDrag: DragState = {
    active: false,
    descriptor: null,
    x: 0,
    y: 0,
    grabDX: 0,
    grabDY: 0,
    target: null,
}

const baseProps = {
    node: leafNode,
    focusId: 'leaf-1',
    onFocus: noop,
    onResize: noop,
    onMenu: noop,
    onClose: noop,
    onDropFile: noop,
    onStartPaneDrag: noop,
    onSaved: noop,
    onOpen: noop,
    onNewTerminal: noop,
    noteNames: noopArr,
    memoryNames: noopArr,
    tagNames: noopArr,
}

const meta = {
    title: 'App/PaneLeaf',
    component: PaneLeaf,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneLeaf>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            width: '360px',
            height: '260px',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

/** A single unsplit pane — `showHeader` false, so no breadcrumb, just the content. */
export const Default: Story = {
    render: () => (
        <Wrap>
            <PaneLeaf
                {...baseProps}
                showHeader={false}
                dragState={() => idleDrag}
            />
        </Wrap>
    ),
}

/** A split pane — `showHeader` true renders the <PaneHeader> breadcrumb, and this leaf is the
 *  tree's focused one, so `.pane-leaf.focused` applies. */
export const WithHeaderFocused: Story = {
    render: () => (
        <Wrap>
            <PaneLeaf
                {...baseProps}
                showHeader={true}
                dragState={() => idleDrag}
            />
        </Wrap>
    ),
}

/** `dragState` reports this leaf as the live drop target with the `left` zone — the only way to
 *  pose `.pane-dropzone` mid-render outside PaneDropZone's own isolated stories. */
export const WithActiveZone: Story = {
    render: () => (
        <Wrap>
            <PaneLeaf
                {...baseProps}
                showHeader={false}
                dragState={() => ({
                    ...idleDrag,
                    active: true,
                    target: { kind: 'pane', leafId: 'leaf-1', zone: 'left' },
                })}
            />
        </Wrap>
    ),
}
