// app/src/preview/ScratchTextLayer.stories.tsx
// Visual + behavioural spec for <ScratchTextLayer> — click-to-place note blocks on a PDF/image's
// scratch strip.
//
// NO PDF.JS, NO REAL STORE. The layer only needs measured page rects, so the stage below lays out
// plain page divs (the PDF page's paper colour) with a note-surface strip beside each, the same
// geometry PdfPages hands PageInk: a US-Letter page rendered 612px wide at 1x — exactly the
// SCRATCH_REF_SCALE, so text renders at the note's own --prose-font-size — with a 0.4 strip.
// The CompanionStore is a small in-story signals object (createCompanionStore is being written in a
// parallel task and is deliberately not imported); it implements add/update/remove exactly as the
// type documents, and `revision` never bumps (nothing here reloads from disk).
//
// TYPING: `document.execCommand('insertText')` inserts into whatever element HOLDS FOCUS, through
// the browser's real editing path CodeMirror observes — so a play() that types and then sees the text
// in `store.blocks()` has proved both that the new block was focused and that its edits reach the
// store.
import { createSignal, type Accessor } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, fireEvent, userEvent, waitFor } from 'storybook/test'
import ScratchTextLayer from './ScratchTextLayer'
import type { PageInkPage } from './PageInk'
import type { AnnotationLoadState, CompanionStore } from './annotationTypes'
import type { ScratchBlock } from '../../../core/src/scratchTypes'
import { PDF_PAGE_PAPER } from '../../../core/src/theme/tokens'

const meta = {
    title: 'Preview/ScratchTextLayer',
    component: ScratchTextLayer,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ScratchTextLayer>

export default meta
type Story = StoryObj<typeof meta>

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

function makeStore(initial: ScratchBlock[] = []): CompanionStore {
    const [blocks, setBlocks] = createSignal<ScratchBlock[]>(initial)
    const [loadState] = createSignal<AnnotationLoadState>('ready')
    const [frontmatter, setFrontmatter] = createSignal('---\ntags: []\n---\n')
    const [revision] = createSignal(0)
    let n = 0
    return {
        loadState,
        frontmatter,
        setFrontmatter,
        blocks,
        revision,
        addBlock: b => {
            const id = `b${++n}`
            setBlocks(list => [...list, { ...b, id }])
            return id
        },
        updateBlock: (id, patch) =>
            setBlocks(list =>
                list.map(b => (b.id === id ? { ...b, ...patch } : b)),
            ),
        removeBlock: id => setBlocks(list => list.filter(b => b.id !== id)),
        flush: () => Promise.resolve(),
    }
}

const GUTTER = 24
const GAP = 24
const NAT = { w: 612, h: 792 }
const RATIO = 0.4

/** Page i laid out at `zoom`: rendered 612*zoom wide, strip RATIO of that. Logical box for a Letter
 *  page is {0, 0, 816, 1056}, so k = 0.75 * zoom. */
const layoutPages = (zoom: number, count = 3): PageInkPage[] =>
    Array.from({ length: count }, (_, i) => {
        const w = NAT.w * zoom
        const h = NAT.h * zoom
        return {
            rendered: { left: GUTTER, top: GUTTER + i * (h + GAP), w, h },
            nat: NAT,
            marginW: w * RATIO,
        }
    })

/** The live store + page accessor for the mounted story, so play() can read and drive them. */
let live: {
    store: CompanionStore
    pages: Accessor<PageInkPage[]>
    setZoom: (z: number) => void
    setStripOff: (v: boolean) => void
    setInteractive: (v: boolean) => void
}

function Stage(props: {
    blocks?: ScratchBlock[]
    interactive?: boolean
    /** Initial layout zoom (1 = the reference scale). */
    zoom?: number
    /** SCRATCH off: every page laid out with no strip. */
    stripOff?: boolean
}) {
    const store = makeStore(props.blocks)
    const [zoom, setZoom] = createSignal(props.zoom ?? 1)
    const [stripOff, setStripOff] = createSignal(props.stripOff ?? false)
    const [interactive, setInteractive] = createSignal(
        props.interactive ?? true,
    )
    const pages = (): PageInkPage[] =>
        stripOff()
            ? layoutPages(zoom()).map(p => ({ ...p, marginW: 0 }))
            : layoutPages(zoom())
    live = { store, pages, setZoom, setStripOff, setInteractive }
    const last = () => pages()[pages().length - 1]!
    // The stage scrolls inside a viewport-sized box, the way PdfPages' scroll content does, so a 2x
    // layout scrolls here instead of widening the page.
    return (
        <div style={{ width: '100%', height: '100vh', overflow: 'auto' }}>
            <div
                data-testid="scratch-stage"
                style={{
                    position: 'relative',
                    width: `${last().rendered.left + last().rendered.w + (last().marginW ?? 0) + GUTTER}px`,
                    height: `${last().rendered.top + last().rendered.h + GUTTER}px`,
                    // The real desk the page stack sits on. `--bg` and `--surface-1` (the strip's
                    // own ground) are near-identical dark tones, so a `--bg` stage made the strip
                    // read as invisible here even though it's a visibly different surface in the app.
                    background: 'var(--editor)',
                }}
            >
                {pages().map(p => (
                    <>
                        <div
                            style={{
                                position: 'absolute',
                                left: `${p.rendered.left}px`,
                                top: `${p.rendered.top}px`,
                                width: `${p.rendered.w}px`,
                                height: `${p.rendered.h}px`,
                                background: PDF_PAGE_PAPER,
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                left: `${p.rendered.left + p.rendered.w}px`,
                                top: `${p.rendered.top}px`,
                                width: `${p.marginW}px`,
                                height: `${p.rendered.h}px`,
                                background: 'var(--surface-1)',
                                'border-left': 'var(--rule-soft)',
                                'box-sizing': 'border-box',
                            }}
                        />
                    </>
                ))}
                <ScratchTextLayer
                    store={store}
                    pages={pages}
                    doc={() => null}
                    interactive={interactive}
                />
            </div>
        </div>
    )
}

/** Host px of a logical point on page i at the current layout. */
const hostOf = (i: number, x: number, y: number) => {
    const p = live.pages()[i]!
    const k = p.rendered.w / 816
    return { left: p.rendered.left + x * k, top: p.rendered.top + y * k }
}

const stageOf = (root: HTMLElement) =>
    root.querySelector<HTMLElement>('[data-testid="scratch-stage"]')!

const blocksIn = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-scratch-block]'))

/** Resolves a CSS custom property to a computed value by painting it on a throwaway probe. */
function resolveVar(root: HTMLElement, prop: string, decl: string): string {
    const probe = document.createElement('div')
    probe.style.setProperty(prop, decl)
    root.appendChild(probe)
    const v = getComputedStyle(probe).getPropertyValue(prop)
    probe.remove()
    return v
}

/** Primary-button pointerdown at host (hx, hy) on page i's strip hit area. */
function clickStrip(root: HTMLElement, i: number, hx: number, hy: number) {
    const hit = root.querySelector<HTMLElement>(`[data-scratch-hit="${i}"]`)!
    const s = stageOf(root).getBoundingClientRect()
    fireEvent.pointerDown(hit, {
        button: 0,
        pointerId: 1,
        clientX: s.left + hx,
        clientY: s.top + hy,
    })
}

/** A REAL click via `userEvent.pointer` (pointerdown+pointerup+click, the browser's own click
 *  path) at host (hx, hy) on page i's strip hit area — used where the story means to prove
 *  something about that real path, not just handler wiring (`clickStrip` above dispatches a
 *  single low-level `fireEvent.pointerDown` and is fine for stories that don't). */
async function pointerClickStrip(
    root: HTMLElement,
    i: number,
    hx: number,
    hy: number,
) {
    const hit = root.querySelector<HTMLElement>(`[data-scratch-hit="${i}"]`)!
    const s = stageOf(root).getBoundingClientRect()
    await userEvent.pointer({
        keys: '[MouseLeft]',
        target: hit,
        coords: { x: s.left + hx, y: s.top + hy },
    })
}

const SEEDED: ScratchBlock[] = [
    {
        id: 's1',
        page: 0,
        x: 846,
        y: 120,
        w: 280,
        text: '**why?** see [[Lecture 7]]',
    },
    {
        id: 's2',
        page: 0,
        x: 846,
        y: 360,
        w: 280,
        text: '- check eq (3)\n- compare with p. 12',
    },
]

// ── Stories ─────────────────────────────────────────────────────────────────────────────────────

/** Three pages with strips, no notes yet: one hit area per strip, nothing mounted, and the
 *  click-anywhere hint on the first page's strip (nothing else says the blank column takes typing). */
export const Empty: Story = {
    render: () => <Stage />,
    play: async ({ canvasElement }) => {
        const layer = canvasElement.querySelector('[data-scratch-text]')
        await expect(layer).not.toBeNull()
        await expect(
            canvasElement.querySelectorAll('[data-scratch-hit]').length,
        ).toBe(3)
        await expect(blocksIn(canvasElement).length).toBe(0)
        const hit = canvasElement.querySelector<HTMLElement>(
            '[data-scratch-hit="1"]',
        )!
        const r = hit.getBoundingClientRect()
        const s = stageOf(canvasElement).getBoundingClientRect()
        const p = live.pages()[1]!
        await expect(
            Math.abs(r.left - s.left - (p.rendered.left + p.rendered.w)),
        ).toBeLessThan(1)
        await expect(Math.abs(r.width - (p.marginW ?? 0))).toBeLessThan(1)

        const hint = canvasElement.querySelector<HTMLElement>(
            '[data-testid="scratch-hint"]',
        )
        await expect(hint).not.toBeNull()
        await expect(hint!.textContent).toBe('click anywhere to write')
    },
}

/** The hint sits at the first strip's top-left, disappears the instant a block exists (even though
 *  the strip is still there), and disappears when the layer stops being interactive even though the
 *  strip is still empty (draw mode etc. offers no affordance for an action it won't accept). */
export const HintOnEmptyStrip: Story = {
    render: () => <Stage />,
    play: async ({ canvasElement }) => {
        const hint = () =>
            canvasElement.querySelector<HTMLElement>(
                '[data-testid="scratch-hint"]',
            )
        await waitFor(() => expect(hint()).not.toBeNull())
        await expect(hint()!.textContent).toBe('click anywhere to write')

        // Sits at the first strip's top-left (the inset is CSS padding, so the element's own box
        // starts right at the corner).
        const s = stageOf(canvasElement).getBoundingClientRect()
        const p = live.pages()[0]!
        const r = hint()!.getBoundingClientRect()
        await expect(
            Math.abs(r.left - s.left - (p.rendered.left + p.rendered.w)),
        ).toBeLessThan(1)
        await expect(Math.abs(r.top - s.top - p.rendered.top)).toBeLessThan(1)

        // Not interactive -> gone, even though the strip is still empty.
        live.setInteractive(false)
        await waitFor(() => expect(hint()).toBeNull())
        live.setInteractive(true)
        await waitFor(() => expect(hint()).not.toBeNull())

        // A block on the strip -> gone, even though the strip stays interactive.
        clickStrip(
            canvasElement,
            0,
            p.rendered.left + p.rendered.w + 30,
            p.rendered.top + 60,
        )
        await waitFor(() => expect(live.store.blocks().length).toBe(1))
        await waitFor(() => expect(hint()).toBeNull())
    },
}

/** Two notes on page 1's strip, rendered like a note body: prose font, fg colour, bold + bullets. */
export const WithBlocks: Story = {
    render: () => <Stage blocks={SEEDED} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(2))
        // Blocks already exist -> the empty-strip hint never mounts.
        await expect(
            canvasElement.querySelector('[data-testid="scratch-hint"]'),
        ).toBeNull()
        const [first, second] = blocksIn(canvasElement)
        const strong = first!.querySelector<HTMLElement>('.cm-strong')
        await expect(strong).not.toBeNull()
        await expect(
            Number(getComputedStyle(strong!).fontWeight),
        ).toBeGreaterThanOrEqual(600)
        await expect(second!.querySelectorAll('.cm-bullet').length).toBe(2)

        const line = first!.querySelector<HTMLElement>('.cm-line')!
        const cs = getComputedStyle(line)
        const proseFont = resolveVar(
            canvasElement,
            'font-family',
            'var(--prose-font)',
        )
        await expect(cs.fontFamily).toBe(proseFont)
        const fgProbe = document.createElement('div')
        fgProbe.style.color = 'var(--fg)'
        canvasElement.appendChild(fgProbe)
        const fg = getComputedStyle(fgProbe).color
        fgProbe.remove()
        await expect(cs.color).toBe(fg)

        // Each block's top-left sits at its logical anchor.
        const s = stageOf(canvasElement).getBoundingClientRect()
        const r = first!.getBoundingClientRect()
        const want = hostOf(0, 846, 120)
        await expect(Math.abs(r.left - s.left - want.left)).toBeLessThan(1)
        await expect(Math.abs(r.top - s.top - want.top)).toBeLessThan(1)
    },
}

/** Clicking the strip starts a focused note exactly at the click; typing lands in the store. */
export const ClickPlacesBlock: Story = {
    render: () => <Stage />,
    play: async ({ canvasElement }) => {
        const p = live.pages()[2]!
        const hx = p.rendered.left + p.rendered.w + 40
        const hy = p.rendered.top + 180
        clickStrip(canvasElement, 2, hx, hy)

        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        const s = stageOf(canvasElement).getBoundingClientRect()
        const r = block.getBoundingClientRect()
        await expect(Math.abs(r.left - s.left - hx)).toBeLessThanOrEqual(4)
        await expect(Math.abs(r.top - s.top - hy)).toBeLessThanOrEqual(4)
        // Never past the strip's right edge.
        await expect(r.right - s.left).toBeLessThanOrEqual(
            p.rendered.left + p.rendered.w + (p.marginW ?? 0),
        )
        await expect(live.store.blocks()[0]!.page).toBe(2)

        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )
        document.execCommand('insertText', false, 'margin thought')
        await waitFor(() =>
            expect(live.store.blocks()[0]!.text).toBe('margin thought'),
        )
    },
}

/** A click on the strip while a note is being edited ENDS that edit and places nothing — a second
 *  click on the now-unfocused strip is what makes the next note, so the affordance isn't lost,
 *  only deferred. Uses a REAL click (`userEvent.pointer`, not `fireEvent`) because the fix reads
 *  `document.activeElement`, which only a real focus-driving click path exercises honestly. */
export const ClickOutEndsEditWithoutPlacing: Story = {
    render: () => <Stage />,
    play: async ({ canvasElement }) => {
        const p = live.pages()[0]!
        const hx = p.rendered.left + p.rendered.w + 30
        const hy1 = p.rendered.top + 60
        const hy2 = p.rendered.top + 400

        await pointerClickStrip(canvasElement, 0, hx, hy1)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )
        document.execCommand('insertText', false, 'margin thought')
        await waitFor(() =>
            expect(live.store.blocks()[0]!.text).toBe('margin thought'),
        )

        // A second click at a DIFFERENT spot on the same strip, while the note is still focused,
        // must END the edit rather than place a second block.
        await pointerClickStrip(canvasElement, 0, hx, hy2)
        await waitFor(() => {
            const layer = canvasElement.querySelector('[data-scratch-text]')!
            expect(layer.contains(document.activeElement)).toBe(false)
        })
        await expect(live.store.blocks().length).toBe(1)
        await expect(blocksIn(canvasElement).length).toBe(1)

        // The affordance is only deferred: clicking the (now unfocused) strip again places a
        // second block.
        await pointerClickStrip(canvasElement, 0, hx, hy2)
        await waitFor(() => expect(live.store.blocks().length).toBe(2))
    },
}

/** A note left blank when the user clicks AWAY (not just when focus otherwise moves) is still
 *  removed — the click-out fix above must not skip the existing blank-block cleanup, since
 *  `onLeave`'s blur-driven removal is what the fix relies on to run at all. */
export const BlankBlockStillRemovedOnClickOut: Story = {
    render: () => <Stage />,
    play: async ({ canvasElement }) => {
        const p = live.pages()[1]!
        const hx = p.rendered.left + p.rendered.w + 30

        await pointerClickStrip(canvasElement, 1, hx, p.rendered.top + 80)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        await waitFor(() =>
            expect(block.contains(document.activeElement)).toBe(true),
        )

        await pointerClickStrip(canvasElement, 1, hx, p.rendered.top + 400)
        await waitFor(() => expect(live.store.blocks().length).toBe(0))
        await expect(blocksIn(canvasElement).length).toBe(0)
    },
}

/** A note left blank disappears when focus leaves it; a note with text stays. */
export const BlankBlockRemovedOnLeave: Story = {
    render: () => (
        <Stage
            blocks={[
                {
                    id: 'kept',
                    page: 1,
                    x: 846,
                    y: 600,
                    w: 280,
                    text: 'keep me',
                },
            ]}
        />
    ),
    play: async ({ canvasElement }) => {
        const p = live.pages()[0]!
        clickStrip(
            canvasElement,
            0,
            p.rendered.left + p.rendered.w + 30,
            p.rendered.top + 90,
        )
        await waitFor(() => expect(live.store.blocks().length).toBe(2))
        const blank = blocksIn(canvasElement).find(
            b => b.dataset.scratchBlock !== 'kept',
        )!
        await waitFor(() =>
            expect(blank.contains(document.activeElement)).toBe(true),
        )

        ;(document.activeElement as HTMLElement).blur()
        await waitFor(() =>
            expect(live.store.blocks().map(b => b.id)).toEqual(['kept']),
        )
        await expect(blocksIn(canvasElement).length).toBe(1)

        // Focusing and leaving the non-blank one keeps it.
        const kept = blocksIn(canvasElement)[0]!
        kept.querySelector<HTMLElement>('.cm-content')!.focus()
        await waitFor(() =>
            expect(kept.contains(document.activeElement)).toBe(true),
        )
        ;(document.activeElement as HTMLElement).blur()
        await expect(live.store.blocks().map(b => b.id)).toEqual(['kept'])
    },
}

/** The hover/focus X deletes a note that has text. */
export const DeleteButton: Story = {
    render: () => <Stage blocks={SEEDED} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(2))
        const target = blocksIn(canvasElement).find(
            b => b.dataset.scratchBlock === 's1',
        )!
        const reveal = target.querySelector<HTMLElement>(
            '[data-testid="scratch-delete"]',
        )!
        const x = reveal.querySelector<HTMLElement>(
            '[aria-label="Delete note"]',
        )!
        // The reveal (opacity/pointer-events) lives on the chrome row, not on `.delete` itself —
        // see ScratchBlock.module.css's `.chrome`.
        const chrome = target.querySelector<HTMLElement>(
            '[data-testid="scratch-chrome"]',
        )!
        await expect(getComputedStyle(chrome).opacity).toBe('0')
        target.querySelector<HTMLElement>('.cm-content')!.focus()
        await waitFor(() => expect(getComputedStyle(chrome).opacity).toBe('1'))
        // Hit-testing AND the click, in one story: `fireEvent.click` dispatches straight at the
        // node and is what hid the original unreachable-X defect.
        const xr = x.getBoundingClientRect()
        const xCentre = { x: xr.left + xr.width / 2, y: xr.top + xr.height / 2 }
        await expect(
            document
                .elementFromPoint(xCentre.x, xCentre.y)
                ?.closest('[data-testid="scratch-delete"]'),
        ).not.toBeNull()
        await userEvent.pointer({ keys: '[MouseLeft]', target: x, coords: xCentre })
        await waitFor(() =>
            expect(live.store.blocks().map(b => b.id)).toEqual(['s2']),
        )
        await expect(blocksIn(canvasElement).length).toBe(1)
    },
}

/** Dragging the move handle onto page 2's strip re-anchors the note there; dropping over the page
 *  itself snaps it back. */
export const DragToAnotherPage: Story = {
    render: () => <Stage blocks={[SEEDED[0]!]} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        const handle = block.querySelector<HTMLElement>(
            '[aria-label="Move note"]',
        )!
        await expect(handle.getAttribute('role')).toBe('button')
        // The chrome row (grip + delete X) only reveals on hover/focus-within (ScratchBlock.tsx),
        // so a real user reaches the grip by having the note focused or hovered first — focus it
        // the same way DeleteButton's story does, so the hit-test below checks the grip in the
        // state a person would actually click it from.
        block.querySelector<HTMLElement>('.cm-content')!.focus()
        const s = stageOf(canvasElement).getBoundingClientRect()
        const h = handle.getBoundingClientRect()
        // The grip must be REACHABLE by a real click before the drag it starts means anything —
        // this is what task 3's chrome-row reflow fixed; a corner-overlap grip failed this exact
        // check (`document.elementFromPoint` returned something else on top of it).
        const centre = { x: h.left + h.width / 2, y: h.top + h.height / 2 }
        const atCentre = document.elementFromPoint(centre.x, centre.y)
        await expect(atCentre).not.toBeNull()
        await expect(
            atCentre!.closest('[data-testid="scratch-move"]'),
        ).not.toBeNull()
        // Grab the handle 20px in from the block's left edge.
        const grab = { x: h.left + 20, y: h.top + h.height / 2 }
        const toClient = (hx: number, hy: number) => ({
            clientX: s.left + hx,
            clientY: s.top + hy,
        })
        const before = block.getBoundingClientRect()
        const offY = grab.y - before.top

        // Drop 1: over page 1's strip (0-based page 1), 200px down.
        const p1 = live.pages()[1]!
        const dropX = p1.rendered.left + p1.rendered.w + 60
        const dropY = p1.rendered.top + 200
        fireEvent.pointerDown(handle, {
            button: 0,
            pointerId: 1,
            clientX: grab.x,
            clientY: grab.y,
        })
        fireEvent.pointerMove(handle, {
            pointerId: 1,
            ...toClient(dropX - 10, dropY - 30),
        })
        // The preview follows the pointer before release.
        await waitFor(() =>
            expect(
                Math.abs(
                    block.getBoundingClientRect().top -
                        (s.top + dropY - 30 - offY),
                ),
            ).toBeLessThan(1),
        )
        fireEvent.pointerMove(handle, {
            pointerId: 1,
            ...toClient(dropX, dropY),
        })
        fireEvent.pointerUp(handle, { pointerId: 1, ...toClient(dropX, dropY) })

        await waitFor(() => expect(live.store.blocks()[0]!.page).toBe(1))
        const moved = live.store.blocks()[0]!
        const k = p1.rendered.w / 816
        await expect(
            Math.abs(moved.y - (dropY - offY - p1.rendered.top) / k),
        ).toBeLessThanOrEqual(1)
        await expect(moved.x).toBeGreaterThanOrEqual(816)
        const at = hostOf(1, moved.x, moved.y)
        await waitFor(() =>
            expect(
                Math.abs(block.getBoundingClientRect().top - s.top - at.top),
            ).toBeLessThan(1),
        )

        // Drop 2: over page 0 itself (not a strip) → snaps back to where it was.
        const h2 = handle.getBoundingClientRect()
        const p0 = live.pages()[0]!
        fireEvent.pointerDown(handle, {
            button: 0,
            pointerId: 2,
            clientX: h2.left + 20,
            clientY: h2.top + 2,
        })
        fireEvent.pointerMove(handle, {
            pointerId: 2,
            ...toClient(p0.rendered.left + 100, p0.rendered.top + 100),
        })
        fireEvent.pointerUp(handle, {
            pointerId: 2,
            ...toClient(p0.rendered.left + 100, p0.rendered.top + 100),
        })
        await waitFor(() =>
            expect(
                Math.abs(block.getBoundingClientRect().top - s.top - at.top),
            ).toBeLessThan(1),
        )
        await expect(live.store.blocks()[0]).toEqual(moved)
    },
}

/** Re-laying the pages scales the note's text with zoom and keeps it on the same point of the page —
 *  down to a floor: a long textbook fit to a narrow pane can shrink `--scratch-scale` well under a
 *  size anyone could read, so the size never drops below `--fs-ui`. Three zooms, ending on the
 *  LARGEST (the shot the audit takes): a small one where the floor holds, the reference scale where
 *  the note reads at the page's own body-text size, and a larger one proving scaling continues above the
 *  floor — visibly bigger than WithBlocks' reference-scale shot, not pixel-identical to it. Stays
 *  under the audit's 1280px viewport throughout (a straight 1x -> 2x range does not: the floor and
 *  the viewport cap are too close together to demonstrate a literal doubling between two points that
 *  are both clear of the floor AND clear of the viewport edge — the exact doubling math is proven
 *  zoom-independently in scratchGeometry.test.ts instead). */
export const ZoomScalesText: Story = {
    render: () => <Stage blocks={[SEEDED[0]!]} zoom={0.3} />,
    play: async ({ canvasElement }) => {
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        const block = blocksIn(canvasElement)[0]!
        const scroller = () => block.querySelector<HTMLElement>('.cm-scroller')!
        const s = () => stageOf(canvasElement).getBoundingClientRect()
        const sizeNow = () => parseFloat(getComputedStyle(scroller()).fontSize)
        const topOk = async () => {
            const want = hostOf(0, 846, 120)
            const r = block.getBoundingClientRect()
            await expect(
                Math.abs(r.top - s().top - want.top),
            ).toBeLessThanOrEqual(2)
            await expect(
                Math.abs(r.left - s().left - want.left),
            ).toBeLessThanOrEqual(2)
        }

        // 1. Small scale: the floor holds rather than shrinking past readable.
        await topOk()
        const floorPx = parseFloat(
            resolveVar(canvasElement, 'font-size', 'var(--fs-ui)'),
        )
        await expect(Math.abs(sizeNow() - floorPx)).toBeLessThanOrEqual(1)

        // 2. Reference scale: the note's text is the page's own body-text size.
        live.setZoom(1)
        const bodyPx = parseFloat(
            resolveVar(canvasElement, 'font-size', 'var(--fs-body)'),
        )
        await waitFor(() =>
            expect(Math.abs(sizeNow() - bodyPx)).toBeLessThanOrEqual(1),
        )
        await topOk()

        // 3. Above the reference scale: still proportional (not re-floored, not capped) — and this
        //    is the shot, so it must be visibly larger than the 1x block in WithBlocks.
        live.setZoom(1.4)
        await waitFor(() =>
            expect(Math.abs(sizeNow() - bodyPx * 1.4)).toBeLessThanOrEqual(1),
        )
        await topOk()
    },
}

/** SCRATCH off (every page's marginW is 0): a stored block on such a page must not render past the
 *  page's right edge with no strip to hold it. Turning the strip back on mounts it again. */
export const StripOffHidesBlocks: Story = {
    render: () => <Stage blocks={[SEEDED[0]!]} stripOff />,
    play: async ({ canvasElement }) => {
        await expect(
            canvasElement.querySelectorAll('[data-scratch-hit]').length,
        ).toBe(0)
        await expect(blocksIn(canvasElement).length).toBe(0)
        await expect(live.store.blocks().length).toBe(1)

        live.setStripOff(false)
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        await expect(
            canvasElement.querySelectorAll('[data-scratch-hit]').length,
        ).toBe(3)
    },
}

/** Not interactive (draw mode, highlight armed, stores not ready): the strip takes no clicks. */
export const NotInteractive: Story = {
    render: () => <Stage blocks={[SEEDED[0]!]} interactive={false} />,
    play: async ({ canvasElement }) => {
        const hit = canvasElement.querySelector<HTMLElement>(
            '[data-scratch-hit="0"]',
        )!
        await expect(getComputedStyle(hit).pointerEvents).toBe('none')
        await waitFor(() => expect(blocksIn(canvasElement).length).toBe(1))
        await expect(
            getComputedStyle(blocksIn(canvasElement)[0]!).pointerEvents,
        ).toBe('none')
        const p = live.pages()[0]!
        clickStrip(
            canvasElement,
            0,
            p.rendered.left + p.rendered.w + 30,
            p.rendered.top + 700,
        )
        await new Promise(r => setTimeout(r, 50))
        await expect(live.store.blocks().length).toBe(1)
        await expect(blocksIn(canvasElement).length).toBe(1)
    },
}
