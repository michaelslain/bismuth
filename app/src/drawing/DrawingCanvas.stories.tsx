// Visual spec for <DrawingCanvas> — the pure-canvas page surface behind a `.draw` file:
// two stacked <canvas> layers (committed strokes + the in-progress live stroke) painted
// from a DrawingDoc via core/src/drawing/render2d.ts. No network, no vault coupling — it
// just needs a doc, a page index, a ToolState, and a theme bucket.
//
// The fixture below is a real DrawingDoc (core/src/drawing/model.ts): `pts` is a flat
// [x, y, pressureByte, ...] triple stream per stroke, exactly what onCommit hands back and
// what strokeOutline()/perfect-freehand consume. Verified structurally in a scratch script
// (see the task report) rather than asserted here — this file only renders it.
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { createSignal } from 'solid-js'
import { DrawingCanvas, type ToolState } from './DrawingCanvas'
import type { DrawingDoc } from '../../../core/src/drawing/model'
import { CATEGORY_SWATCHES } from '../../../core/src/theme/tokens'
import './Drawing.css'

const meta = {
    title: 'Drawing/DrawingCanvas',
    component: DrawingCanvas,
    parameters: { layout: 'padded' },
} satisfies Meta<typeof DrawingCanvas>

export default meta
type Story = StoryObj<typeof meta>

const DEFAULT_TOOLS: ToolState = {
    tool: 'pen',
    color: 'fg',
    size: 5,
    smoothMode: 'smooth',
    holdToStraighten: true,
    holdDelayMs: 900,
}

/** A grid-paper page with two committed strokes: a pen swoop in the theme's own ink color
 *  ("fg" — resolved live by render2d/theme.ts, never a literal hex) and a gold highlighter
 *  bar (a literal color, per the real data contract: only "fg" is a resolved sentinel —
 *  everything else must already be a concrete stored color, see Toolbar.tsx). */
function twoStrokeDoc(): DrawingDoc {
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'grid' },
        pages: [
            {
                strokes: [
                    {
                        t: 'pen',
                        c: 'fg',
                        w: 5,
                        pts: [
                            120, 200, 180, 220, 140, 200, 340, 120, 220, 460,
                            180, 210, 560, 300, 190, 500, 400, 170,
                        ],
                    },
                    {
                        t: 'hl',
                        c: CATEGORY_SWATCHES.gold,
                        w: 22,
                        pts: [140, 460, 255, 420, 460, 255],
                    },
                ],
            },
        ],
    }
}

/** A blank untouched page — the state a new `.draw` file (or a freshly added page) opens to. */
function blankDoc(): DrawingDoc {
    return {
        v: 1,
        kind: 'drawing',
        paper: { bg: 'blank' },
        pages: [{ strokes: [] }],
    }
}

/** A grid-paper page holding a pen stroke + a highlighter stroke, rendered at a fixed width
 *  (the real host — DrawingPage.tsx's `.draw-page-zoom` — sizes this via a % width the zoom
 *  control scales; here it's pinned so the story doesn't depend on that control). */
export const Default: Story = {
    render: () => {
        const [doc] = createSignal(twoStrokeDoc())
        const [tools] = createSignal(DEFAULT_TOOLS)
        return (
            <div style={{ width: '420px' }}>
                <DrawingCanvas
                    doc={doc}
                    pageIndex={0}
                    tools={tools}
                    theme={() => 'dark'}
                    onCommit={() => {}}
                    onEraseStroke={() => {}}
                />
            </div>
        )
    },
}

/** A blank page (bg: "blank", no strokes) — no grid wash, no ink, the state a page starts
 *  in before any stroke is drawn or before an image is placed on it. */
export const BlankPage: Story = {
    render: () => {
        const [doc] = createSignal(blankDoc())
        const [tools] = createSignal(DEFAULT_TOOLS)
        return (
            <div style={{ width: '420px' }}>
                <DrawingCanvas
                    doc={doc}
                    pageIndex={0}
                    tools={tools}
                    theme={() => 'dark'}
                    onCommit={() => {}}
                    onEraseStroke={() => {}}
                />
            </div>
        )
    },
}
