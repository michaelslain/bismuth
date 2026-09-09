// app/src/editor/drawBlock.ts
//
// The ```draw embedded block: a fenced block holding a note's ink (see
// core/src/drawing/drawBlocks.ts for the fence scan + read/write helpers). Unlike every other
// embedded block in this family (queryBlock.ts, graphBlock.ts), the fence NEVER reveals its raw
// source — the user asked for it to be invisible, full stop, so there is no reveal-on-cursor-entry
// affordance here. The replaced range is atomic: arrow keys step OVER the block instead of landing
// a caret inside it.
//
// Two shapes, decided by the fence's OWN info string (core/src/drawing/drawBlocks.ts's
// `standalone`: ```draw is attached, ```draw block is standalone). Deliberately not inferred
// from a blank line above the fence — that inference let an edit elsewhere in the note flip a
// fence's mode and reinterpret its stored geometry, which is exactly what made pressing Enter at
// the end of an annotated paragraph throw its annotation 78px down the page:
//   - Attached: the block above already occupies its own height: the widget replacing the fence
//     itself reserves ZERO height. Task 5's overlay paints this block's ink over the text above it.
//   - Standalone: there is no text to paint over, so the widget reserves the ink's own bounding-box
//     height (drawBlockGeometry.ts's `standaloneHeight`) so the document still flows correctly and
//     text after the drawing has somewhere to sit — see the design doc's "i cant place text after
//     it" complaint.
//
// This module intentionally does NOT paint anything — a bare sized `<div>` is enough here; Task 5's
// retargeted overlay does the actual ink rendering on top of (or inside) these reserved rects.
import {
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import { StateField, type EditorState, type Extension } from '@codemirror/state'
import { scanDrawBlocks, type DrawBlock } from '../../../core/src/drawing/drawBlocks'
import { standaloneHeight } from './drawBlockGeometry'
import { INK_LOGICAL_W } from '../../../core/src/drawing/ink'

// Ink-logical px reserved above and below a standalone drawing's ink, on both sides — matches
// the padding a hand-drawn sketch wants to breathe before the next block starts.
export const STANDALONE_PAD = 24

class DrawBlockWidget extends WidgetType {
    private ro?: ResizeObserver

    constructor(
        readonly strokes: DrawBlock['strokes'],
        readonly standalone: boolean,
    ) {
        super()
    }

    eq(other: DrawBlockWidget): boolean {
        return (
            other.standalone === this.standalone &&
            other.strokes === this.strokes
        )
    }

    private currentScale(view: EditorView): number {
        const w = view.contentDOM.getBoundingClientRect().width
        return w > 0 ? w / INK_LOGICAL_W : 1
    }

    private applyHeight(div: HTMLElement, view: EditorView): void {
        if (!this.standalone) return
        const logicalHeight = standaloneHeight(this.strokes, STANDALONE_PAD)
        const scale = this.currentScale(view)
        div.style.height = `${logicalHeight * scale}px`
    }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement('div')
        div.dataset.drawBlock = ''
        if (this.standalone) {
            div.dataset.drawStandalone = ''
            div.style.display = 'block'
            div.style.width = '100%'
            this.applyHeight(div, view)
            // Keep the reserved height in sync with pane-width changes (sidebar toggle, window
            // resize) — the same fixed-logical-space rescale InkOverlay.tsx does for painted ink.
            this.ro = new ResizeObserver(() => this.applyHeight(div, view))
            this.ro.observe(view.contentDOM)
        }
        return div
    }

    destroy(): void {
        this.ro?.disconnect()
        this.ro = undefined
    }

    ignoreEvent(): boolean {
        return true
    }
}

function buildDrawDecorations(state: EditorState): DecorationSet {
    const text = state.doc.toString()
    if (text.indexOf('```draw') === -1) return Decoration.none
    const blocks = scanDrawBlocks(text)
    if (!blocks.length) return Decoration.none

    const doc = state.doc
    const deco = blocks.map(b => {
        const from = doc.line(b.fromLine).from
        const to = doc.line(b.toLine).to
        const widget = new DrawBlockWidget(b.strokes, b.standalone)
        return Decoration.replace({ widget, block: true }).range(from, to)
    })
    return Decoration.set(deco, true)
}

const drawBlockField = StateField.define<DecorationSet>({
    create(state) {
        return buildDrawDecorations(state)
    },
    update(value, tr) {
        if (tr.docChanged) return buildDrawDecorations(tr.state)
        return value.map(tr.changes)
    },
    provide: f => EditorView.decorations.from(f),
})

/** The CodeMirror extension: hides every ```draw fence and replaces it with an atomic widget
 *  that reserves either zero height (attached) or the ink's own height (standalone). */
export function drawBlockExtension(): Extension {
    return [
        drawBlockField,
        // Make the whole replaced range one atomic unit so ArrowLeft/ArrowRight step OVER the
        // block instead of placing a caret inside the (invisible) fence — the fence must never
        // reveal its source, unlike queryBlock.ts / graphBlock.ts.
        EditorView.atomicRanges.of(view => view.state.field(drawBlockField)),
    ]
}
