// Visual spec for <PaneTree> — the recursive renderer for one tab's pane layout: a leaf shows
// content, a split divides space between two children with a draggable divider.
//
// WHY THIS FILE EXISTS: `.pane-split`/`.pane-child`/`.pane-divider` (App.css, plus the
// `@keyframes pane-in` animation `.pane-child` uses — Trap 6, invisible to a `^\.`-anchored grep)
// move into the shared PaneTree.module.css alongside the leaf-family rules covered by
// PaneLeaf.stories.tsx / PaneHeader.stories.tsx / PaneDropZone.stories.tsx. Recorded BEFORE that
// move, per THE RECIPE.
//
// NO FIXTURE SEAM NEEDED: every leaf's content is the `::graph` sentinel (GRAPH_TAB), which
// PaneContent routes to a bare placeholder div with no fetch (see PaneLeaf.stories.tsx).
//
// FIVE STORIES: SingleLeaf (the Show's fallback branch — no split at all). RowSplit / ColSplit —
// the two `dir` values, each producing `.pane-split.row`/`.col` and matching `.pane-divider.row`/
// `.col` cursor rules. NestedSplit — a split whose child is itself a split, exercising the
// recursion (`<PaneTree {...props} node={split().a} />`). Resizing — `.pane-split.resizing`
// (suppresses the flex-basis transition + animation while a divider drag is live), posed via a
// `play` that pointerdowns the divider rather than a prop, since `resizing` is PaneTree's own
// internal signal with no prop escape hatch.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { PaneTree } from './PaneTree'
import { GRAPH_TAB } from './tabIds'
import type { DragState } from './dnd/viewDrag'
import type { PaneNode } from './panes'
import styles from './PaneTree.module.css'

const noop = () => {}
const noopArr = () => []

const idleDrag: DragState = {
    active: false,
    descriptor: null,
    x: 0,
    y: 0,
    grabDX: 0,
    grabDY: 0,
    target: null,
}

const leaf = (id: string): PaneNode => ({
    kind: 'leaf',
    id,
    content: GRAPH_TAB,
})

const baseProps = {
    focusId: 'a',
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
    dragState: () => idleDrag,
}

const meta = {
    title: 'App/PaneTree',
    component: PaneTree,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof PaneTree>

export default meta
type Story = StoryObj<typeof meta>

const Wrap = (props: { children: unknown }) => (
    <div
        style={{
            width: '420px',
            height: '280px',
            border: '1px solid var(--border-soft)',
        }}
    >
        {props.children as never}
    </div>
)

/** No split at all — the Show's fallback branch renders a bare <PaneLeaf>. */
export const SingleLeaf: Story = {
    render: () => (
        <Wrap>
            <PaneTree {...baseProps} node={leaf('a')} showHeader={false} />
        </Wrap>
    ),
}

/** `dir: "row"` — side-by-side panes, `.pane-split.row` + `.pane-divider.row` (col-resize cursor). */
export const RowSplit: Story = {
    render: () => (
        <Wrap>
            <PaneTree
                {...baseProps}
                showHeader={true}
                node={{
                    kind: 'split',
                    id: 's1',
                    dir: 'row',
                    ratio: 0.5,
                    a: leaf('a'),
                    b: leaf('b'),
                }}
            />
        </Wrap>
    ),
}

/** `dir: "col"` — stacked panes, `.pane-split.col` + `.pane-divider.col` (row-resize cursor). */
export const ColSplit: Story = {
    render: () => (
        <Wrap>
            <PaneTree
                {...baseProps}
                showHeader={true}
                node={{
                    kind: 'split',
                    id: 's1',
                    dir: 'col',
                    ratio: 0.5,
                    a: leaf('a'),
                    b: leaf('b'),
                }}
            />
        </Wrap>
    ),
}

/** A split whose `b` child is itself a split — exercises `<PaneTree node={split().b} />`'s
 *  recursive call, the one path none of the other stories reach. */
export const NestedSplit: Story = {
    render: () => (
        <Wrap>
            <PaneTree
                {...baseProps}
                showHeader={true}
                node={{
                    kind: 'split',
                    id: 's1',
                    dir: 'row',
                    ratio: 0.4,
                    a: leaf('a'),
                    b: {
                        kind: 'split',
                        id: 's2',
                        dir: 'col',
                        ratio: 0.5,
                        a: leaf('b'),
                        b: leaf('c'),
                    },
                }}
            />
        </Wrap>
    ),
}

/** `.pane-split.resizing` — suppresses the flex-basis transition while a divider drag is live.
 *  `resizing` is an internal signal with no prop escape hatch, so this poses it the only way
 *  possible: a `play` that pointerdowns the divider (mirroring PaneTree's own `startDrag`, which
 *  listens on `pointerdown` and flips the signal synchronously before attaching window
 *  move/up listeners). Asserted directly so the story fails loudly if the mechanism stops working,
 *  rather than quietly recording a non-resizing rail as if it were mid-drag. */
export const Resizing: Story = {
    render: () => (
        <Wrap>
            <PaneTree
                {...baseProps}
                showHeader={true}
                node={{
                    kind: 'split',
                    id: 's1',
                    dir: 'row',
                    ratio: 0.5,
                    a: leaf('a'),
                    b: leaf('b'),
                }}
            />
        </Wrap>
    ),
    play: async ({ canvasElement }) => {
        const divider = canvasElement.querySelector(
            `.${styles['pane-divider']}`,
        )
        if (!(divider instanceof HTMLElement))
            throw new Error('divider not found')
        divider.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
            }),
        )
        const split = canvasElement.querySelector(`.${styles['pane-split']}`)
        await expect(
            split?.classList.contains(styles['resizing']),
        ).toBe(true)
        // Clean up the window listeners the drag attached, so the story doesn't leak them.
        window.dispatchEvent(new PointerEvent('pointerup'))
    },
}
