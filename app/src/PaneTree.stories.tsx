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
import { expect, waitFor } from 'storybook/test'
import { PaneTree } from './PaneTree'
import { GRAPH_TAB } from './tabIds'
import type { DragState } from './dnd/viewDrag'
import type { PaneNode } from './panes'
import {
    closeLeaf,
    leafCount,
    movePane,
    replacePaneWithPane,
    resolveFocus,
    setRatio,
} from './panes'
import { createViewDrag } from './dnd/viewDrag'
import { DragGhost } from './shell/DragGhost'
import { createSignal, Show } from 'solid-js'
import styles from './PaneTree.module.css'
import { setTransport } from './api'
import { fakeTransport } from './ui/_fakeTransport'

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

const CODE_PATH = 'src/example.ts'
const NOTE_PATH = 'Market power notes.md'

/** The initial live layout: a code preview (its own bar claims the pane chrome) | a note over the
 *  graph placeholder (both bar-less, so PaneHeader carries their chrome). */
const liveRoot = (): PaneNode => ({
    kind: 'split',
    id: 's1',
    dir: 'row',
    ratio: 0.5,
    a: { kind: 'leaf', id: 'a', content: CODE_PATH },
    b: {
        kind: 'split',
        id: 's2',
        dir: 'col',
        ratio: 0.6,
        a: { kind: 'leaf', id: 'b', content: NOTE_PATH },
        b: { kind: 'leaf', id: 'c', content: GRAPH_TAB },
    },
})

/** A pane tree holding REAL state, driven by the app's own drag controller (dnd/viewDrag.ts) and
 *  the same pure pane ops App.tsx's drop handler calls (panes.ts's movePane /
 *  replacePaneWithPane / closeLeaf / setRatio) — so dragging a pane by its top row, dropping it on
 *  another pane's edge or centre, closing it and resizing all actually happen here, with the app's
 *  DragGhost following the pointer. A story handed over to TRY must not be a no-op stub. */
function LivePanes() {
    const [root, setRoot] = createSignal<PaneNode>(liveRoot())
    const [focusId, setFocusId] = createSignal('a')
    const viewDrag = createViewDrag((d, t) => {
        if (d.kind !== 'pane' || t.kind !== 'pane') return
        const res =
            t.zone === 'center'
                ? replacePaneWithPane(root(), t.leafId, d.leafId)
                : movePane(root(), d.leafId, t.leafId, t.zone)
        if (!res) return
        setRoot(res.root)
        setFocusId(res.focusId)
    })
    const drag = viewDrag.state
    return (
        <>
            <PaneTree
                {...baseProps}
                node={root()}
                focusId={focusId()}
                showHeader={leafCount(root()) > 1}
                onFocus={setFocusId}
                onResize={(id, ratio) => setRoot(r => setRatio(r, id, ratio))}
                onClose={id => {
                    const r = closeLeaf(root(), id)
                    if (!r) return
                    setRoot(r)
                    setFocusId(resolveFocus(r, focusId()))
                }}
                dragState={drag}
                onStartPaneDrag={(e, leafId, label) =>
                    viewDrag.startPane(e, 'story-tab', leafId, label)
                }
            />
            <Show when={drag().active}>
                <DragGhost
                    label={drag().descriptor?.label ?? ''}
                    pane={true}
                    x={drag().x - Math.min(drag().grabDX, 200)}
                    y={drag().y - drag().grabDY}
                    width={Math.min(drag().descriptor?.width ?? 0, 200)}
                />
            </Show>
        </>
    )
}

/**
 * THE MERGED PANE TOP, LIVE. A view that draws its own ViewBar (the code preview — PreviewBar, the
 * same bar a PDF or image gets) claims the pane's chrome (ui/paneChrome.ts): ONE row, its bar,
 * with the pane's [×] last in the trail and the bar itself the drag handle. The note and graph
 * draw no bar, so PaneLeaf keeps its fallback PaneHeader — itself a name-only ViewBar, so all three
 * tops share one height, hairline and [×]. Before this, the preview pane stacked PaneHeader over
 * its bar and repeated the file's icon and name on both rows.
 *
 * Try it: drag any pane by its top row onto another pane's edge (split beside it) or centre
 * (replace it); close one with [×]; drag the dividers. Clicking a pane focuses it and undims its
 * title.
 */
export const RowSplitBarBesideNote: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [CODE_PATH]:
                        'export const greet = (name: string) => `Hello, ${name}!`\n',
                    [NOTE_PATH]: 'A monopolist sets price where MR = MC.\n',
                },
            }),
        )
        return (
            <div
                style={{
                    width: '900px',
                    height: '420px',
                    border: '1px solid var(--border-soft)',
                }}
            >
                <LivePanes />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const pane = (content: string) =>
            canvasElement.querySelector(`[data-pane-content="${content}"]`)!
        await waitFor(() =>
            expect(
                pane(CODE_PATH).querySelector(
                    '[data-pane-chrome] [data-testid="crumb-title"]',
                )?.textContent,
            ).toBe('example.ts'),
        )
        // Every pane has exactly ONE top row carrying its [×]: the preview's own bar, and
        // PaneHeader (a name-only ViewBar) on the two bar-less panes.
        for (const c of [CODE_PATH, NOTE_PATH, GRAPH_TAB]) {
            await expect(pane(c).querySelectorAll('[data-pane-chrome]').length).toBe(1)
            await expect(
                pane(c).querySelectorAll('[aria-label="Close pane"]').length,
            ).toBe(1)
        }
    },
}

/** The same live harness, proving the drag end to end: two REAL pointer drags through
 *  dnd/viewDrag.ts — one from the preview's own bar (onto the note's right edge: it lands beside
 *  the note), one from a PaneHeader row (the graph's, onto the note's centre: it replaces the
 *  note). Kept apart from RowSplitBarBesideNote so the story handed over to try opens on the
 *  untouched three-pane layout, not the post-drag one. */
export const PaneDragFromTheBar: Story = {
    render: () => {
        setTransport(
            fakeTransport({
                files: {
                    [CODE_PATH]:
                        'export const greet = (name: string) => `Hello, ${name}!`\n',
                    [NOTE_PATH]: 'A monopolist sets price where MR = MC.\n',
                },
            }),
        )
        return (
            <div
                style={{
                    width: '900px',
                    height: '420px',
                    border: '1px solid var(--border-soft)',
                }}
            >
                <LivePanes />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const pane = (content: string) =>
            canvasElement.querySelector(`[data-pane-content="${content}"]`)!
        await waitFor(() =>
            expect(
                pane(CODE_PATH).querySelector(
                    '[data-pane-chrome] [data-testid="crumb-title"]',
                )?.textContent,
            ).toBe('example.ts'),
        )
        // Every pane has exactly ONE top row carrying its [×]: the preview's own bar, and
        // PaneHeader (a name-only ViewBar) on the two bar-less panes.
        for (const c of [CODE_PATH, NOTE_PATH, GRAPH_TAB]) {
            await expect(pane(c).querySelectorAll('[data-pane-chrome]').length).toBe(1)
            await expect(
                pane(c).querySelectorAll('[aria-label="Close pane"]').length,
            ).toBe(1)
        }

        // A REAL drag: press the preview's bar (off its controls), move onto the note pane's right
        // edge, release — the preview must land to the right of the note.
        const bar = pane(CODE_PATH).querySelector('[data-pane-chrome]') as HTMLElement
        const from = bar.getBoundingClientRect()
        const to = pane(NOTE_PATH).getBoundingClientRect()
        const at = (x: number, y: number) => ({
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: x,
            clientY: y,
        })
        const sx = from.left + from.width / 2
        const sy = from.top + from.height / 2
        bar.dispatchEvent(new PointerEvent('pointerdown', at(sx, sy)))
        const tx = to.right - 4
        const ty = to.top + to.height / 2
        window.dispatchEvent(new PointerEvent('pointermove', at(sx + 20, sy + 20)))
        window.dispatchEvent(new PointerEvent('pointermove', at(tx, ty)))
        window.dispatchEvent(new PointerEvent('pointerup', at(tx, ty)))

        await waitFor(() => {
            const order = [
                ...canvasElement.querySelectorAll('[data-pane-content]'),
            ].map(el => el.getAttribute('data-pane-content'))
            expect(order).toEqual([NOTE_PATH, CODE_PATH, GRAPH_TAB])
        })
        // It moved beside the note, not on top of it: both still exist, and the moved pane still
        // carries its one-row chrome.
        await expect(
            pane(CODE_PATH).querySelectorAll('[aria-label="Close pane"]').length,
        ).toBe(1)

        // And from a PaneHeader row (the bar-less graph pane): drop it on the note's CENTRE, which
        // replaces the note in place.
        const head = pane(GRAPH_TAB).querySelector('[data-pane-chrome]') as HTMLElement
        const hr = head.getBoundingClientRect()
        const nr = pane(NOTE_PATH).getBoundingClientRect()
        const hx = hr.left + hr.width / 3
        const hy = hr.top + hr.height / 2
        head.dispatchEvent(new PointerEvent('pointerdown', at(hx, hy)))
        const cx = nr.left + nr.width / 2
        const cy = nr.top + nr.height / 2
        window.dispatchEvent(new PointerEvent('pointermove', at(hx + 20, hy - 20)))
        window.dispatchEvent(new PointerEvent('pointermove', at(cx, cy)))
        window.dispatchEvent(new PointerEvent('pointerup', at(cx, cy)))
        await waitFor(() => {
            const order = [
                ...canvasElement.querySelectorAll('[data-pane-content]'),
            ].map(el => el.getAttribute('data-pane-content'))
            expect(order).toEqual([GRAPH_TAB, CODE_PATH])
        })
    },
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
