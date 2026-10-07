// Visual spec for <Toolbar> — the floating bottom-center drawing tool dock (design's
// .drawtools): tools | color/size | smooth/paper | undo-redo/zoom, each an optional group.
// `.draw-toolbar` is `position: absolute; bottom: 20px` against its nearest positioned
// ancestor — DrawingPage.tsx supplies that via its own `.draw-app { position: relative }`
// (DrawingPage.module.css) — so these stories reproduce just that one CSS property inline
// rather than reaching into DrawingPage's module for a class, which would recreate the exact
// cross-component coupling this migration removes.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect } from 'storybook/test'
import { createSignal } from 'solid-js'
import { Toolbar } from './Toolbar'
import type { ToolState } from './DrawingCanvas'
import type { PaperBg } from '../../../core/src/drawing/model'

const meta = {
    title: 'Drawing/Toolbar',
    component: Toolbar,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof Toolbar>

export default meta
type Story = StoryObj<typeof meta>

function useToolState() {
    const [tools, setToolsSig] = createSignal<ToolState>({
        tool: 'pen',
        color: 'fg',
        size: 5,
        smoothMode: 'smooth',
        holdToStraighten: true,
        holdDelayMs: 900,
    })
    const setTools = (patch: Partial<ToolState>) =>
        setToolsSig(t => ({ ...t, ...patch }))
    return { tools, setTools }
}

/** The full page-drawing dock (DrawingPage.tsx's own usage): tools, color/size, smooth +
 *  paper background, undo/redo + zoom — every optional group present. */
export const Full: Story = {
    render: () => {
        const { tools, setTools } = useToolState()
        const [bg, setBg] = createSignal<PaperBg>('grid')
        const [zoom, setZoom] = createSignal(1)
        return (
            <div style={{ position: 'relative', height: '220px' }}>
                <Toolbar
                    tools={tools}
                    setTools={setTools}
                    bg={bg}
                    setBackground={setBg}
                    onUndo={() => {}}
                    onRedo={() => {}}
                    zoom={zoom}
                    onZoomIn={() =>
                        setZoom(z =>
                            Math.min(4, Math.round((z + 0.05) * 100) / 100),
                        )
                    }
                    onZoomOut={() =>
                        setZoom(z =>
                            Math.max(0.25, Math.round((z - 0.05) * 100) / 100),
                        )
                    }
                    onResetZoom={() => setZoom(1)}
                    onImportImage={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        // Every group is here — EXCEPT the lasso, which is note-ink only. This surface has no
        // selection model, so a lasso segment on it would be a control that does nothing.
        expect(canvasElement.querySelector('[title="Pen"]')).not.toBeNull()
        expect(canvasElement.querySelector('[title="Eraser"]')).not.toBeNull()
        expect(canvasElement.querySelector('[title="Lasso"]')).toBeNull()
        // Undo/redo + the zoom group now compose SegmentedToggle via SegmentedOption's
        // `ariaLabel`/`class` — same aria-labels as before the composition, and the percent
        // readout keeps its fixed-width class.
        expect(
            canvasElement.querySelector('[aria-label="Undo"]'),
        ).not.toBeNull()
        expect(
            canvasElement.querySelector('[aria-label="Redo"]'),
        ).not.toBeNull()
        const resetZoom = canvasElement.querySelector<HTMLElement>(
            '[aria-label="Reset zoom"]',
        )!
        expect(resetZoom).not.toBeNull()
        expect(resetZoom.textContent).toBe('100%')
    },
}

/** A NARROW surface — the one the dock used to break on. The box is capped at
 *  `calc(100% - 24px)` so it cannot run off the surface, and its row could not wrap, so on a pane
 *  this size the bordered box stopped at the cap while the groups kept going: the pen toggle, the
 *  first colour and undo/redo painted OUTSIDE their own border and the smoothing zigzag was
 *  clipped (`preview-pageink--pdf-ink-on-second-page-only`). The assertion is the containment
 *  itself — every control inside the box it belongs to — so it fails on any dock narrower than
 *  what it holds, whichever of the two rules regresses. 380px is comfortably under the dock's own
 *  width, so the cap is doing real work here rather than being slack. */
export const Narrow: Story = {
    render: () => {
        const { tools, setTools } = useToolState()
        const [bg, setBg] = createSignal<PaperBg>('grid')
        const [zoom, setZoom] = createSignal(1)
        return (
            <div
                style={{ position: 'relative', height: '260px', width: '380px' }}
            >
                <Toolbar
                    tools={tools}
                    setTools={setTools}
                    bg={bg}
                    setBackground={setBg}
                    onUndo={() => {}}
                    onRedo={() => {}}
                    zoom={zoom}
                    onZoomIn={() => setZoom(1)}
                    onZoomOut={() => setZoom(1)}
                    onResetZoom={() => setZoom(1)}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const dock = canvasElement.querySelector<HTMLElement>(
            '[data-draw-toolbar]',
        )!
        expect(dock).not.toBeNull()
        const box = dock.getBoundingClientRect()
        const controls = [
            ...dock.querySelectorAll<HTMLElement>('button'),
        ]
        // Every tool, colour, size, smoothing, paper and zoom control — if this count collapses
        // the containment below is being asserted over nothing.
        expect(controls.length).toBeGreaterThan(15)
        for (const c of controls) {
            const r = c.getBoundingClientRect()
            expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5)
            expect(r.right).toBeLessThanOrEqual(box.right + 0.5)
            // VERTICAL containment too. The row is allowed to wrap at this width, and a wrapped
            // second line that the dock's own height does not grow to cover is clipped — which
            // horizontal containment alone cannot see, because a clipped control still sits
            // between the dock's left and right edges.
            expect(
                r.top,
                'a control sits above the dock — the wrapped row is clipped',
            ).toBeGreaterThanOrEqual(box.top - 0.5)
            expect(
                r.bottom,
                'a control sits below the dock — the wrapped second row is clipped',
            ).toBeLessThanOrEqual(box.bottom + 0.5)
        }
    },
}

/** The minimal note-ink overlay usage (app/src/editor/InkOverlay.tsx's real call site):
 *  no paper background, no zoom, no image import — since ink annotates a note rather than a
 *  dedicated `.draw` page — but WITH the lasso, which is the note-ink half of "select it and
 *  move it around": select strokes inside one block, then drag or resize them there. */
export const Minimal: Story = {
    render: () => {
        const { tools, setTools } = useToolState()
        return (
            <div style={{ position: 'relative', height: '160px' }}>
                <Toolbar
                    tools={tools}
                    setTools={setTools}
                    lasso
                    onUndo={() => {}}
                    onRedo={() => {}}
                />
            </div>
        )
    },
    play: async ({ canvasElement }) => {
        const lasso = canvasElement.querySelector<HTMLElement>(
            '[title="Lasso"]',
        )
        expect(lasso).not.toBeNull()
        expect(canvasElement.querySelector('[title="Paper"]')).toBeNull()
        // It is a real segment in the mutually-exclusive tool row, not a stray button: picking
        // it deselects the pen.
        const pen = canvasElement.querySelector<HTMLElement>('[title="Pen"]')!
        // Attribute read, not a class: Button stamps data-state on its root as
        // 'normal'/'selected'/'unselected', so this reads the real state directly.
        const selected = (el: HTMLElement) =>
            el.getAttribute('data-state') === 'selected'
        expect(selected(pen)).toBe(true)
        lasso!.click()
        expect(selected(lasso!)).toBe(true)
        expect(selected(pen)).toBe(false)
    },
}
