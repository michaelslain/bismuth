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
//
// ── The drag surface (the "move it around" the user asked for, half one of two) ───────────────
// A STANDALONE block IS the drag surface, over its whole area: pressing anywhere on the drawing
// REORDERS it among the note's blocks. It used to be a 14px invisible strip down the left edge,
// which nobody could find — that strip started as a painted dotted band and the user rejected it
// twice as not seamless ("i dont like this handle, i told u that it hsould be seemless"), leaving
// reordering with no discoverable affordance at all. Their answer, and this one: "there should be
// a hand cursor when u hover over a drawing, dragging with the mouse should drag the drawing when
// not on draw mode." So the whole drawing is the handle and the CURSOR is the affordance.
//
// Only standalone: an attached fence is owned by the paragraph above it and moving it on its own
// would hand its ink to a different paragraph, which is the one thing the ownership model forbids.
// (Half two is the LASSO, in InkOverlay.tsx — moving ink INSIDE its own block.)
//
// **And only outside DRAW MODE.** In draw mode a pointer-down on a drawing is a pen stroke and
// must stay one — a mode check inverted here makes it impossible to draw on top of an existing
// drawing, which is a worse defect than the discoverability problem this fixes. The signal needs
// no new plumbing: `Editor.tsx`'s `setDraw` reconfigures `EditorView.editable.of(!on)`, so the
// view is non-editable exactly while draw mode is on, and `drawBlock` reads that facet directly.
// A note non-editable for any OTHER reason should not be draggable either, so the equivalence is
// the behaviour wanted rather than a coincidence being worked around.
//
// The drop target is "between two markdown blocks in this document", which `app/src/dnd/` cannot
// express: `createViewDrag`'s `DropTarget` is a closed union of tabstrip/pane/folder/root and it
// resolves targets by `elementFromPoint` + `closest('[data-pane-leaf]')`, none of which exists
// inside a CodeMirror document. What DID fit unchanged is its pure geometry — `insertionIndexForY`
// answers exactly "which slot does this cursor y fall between", so that is imported rather than
// rewritten, and only the stateful pointer glue is local.
import {
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import { StateField, type EditorState, type Extension } from '@codemirror/state'
import {
    scanDrawBlocks,
    type DrawBlock,
} from '../../../core/src/drawing/drawBlocks'
import { standaloneHeight } from './drawBlockGeometry'
import { INK_LOGICAL_W } from '../../../core/src/drawing/model'
import { insertionIndexForY } from '../dnd/geometry'
import { planReorder } from './inkCommit'
import { extractFrontmatterBoundary } from './frontmatterUtils'

// Ink-logical px reserved above and below a standalone drawing's ink, on both sides — matches
// the padding a hand-drawn sketch wants to breathe before the next block starts.
export const STANDALONE_PAD = 24

/** One place a dragged drawing can land, in CodeMirror's own height-map coordinates (measured
 *  from `view.documentTop`, so they survive scrolling without bookkeeping).
 *
 *  A slot is a whole markdown BLOCK, not a line: a run of consecutive non-blank lines together
 *  with the attached fence that annotates it, or a standalone drawing. Offering per-LINE slots
 *  would let a drop land in the middle of a paragraph, where inserting a fence with blank lines
 *  around it splits that paragraph in two — the same "paragraph boundaries, never line
 *  boundaries" rule the seam table follows. */
interface DropSlot {
    y: number
    h: number
    /** The 1-based line a fence dropped after this slot should follow. For an annotated
     *  paragraph this is the last line of its ATTACHED FENCE, not of its prose — see
     *  `dropSlots`. */
    afterLine: number
}

/** Every place the dragged fence could go, top to bottom, plus the first line a drop is allowed
 *  to follow.
 *
 *  **An ATTACHED fence is not a landing site — it is part of its paragraph.** This is the whole
 *  reason the function is shaped this way. Treating one as its own slot put a landing site
 *  BETWEEN a paragraph and its own annotation, so dropping a drawing "after this paragraph"
 *  spliced it into that gap; `attachedToLine` then found the dropped fence's closing backticks
 *  as the nearest non-blank line above and re-parented the annotation onto the drawing.
 *  Measured, ink that sat half a pixel above its paragraph's top ended up 38px below it, off its
 *  words entirely — for scale, this design rewrote its whole mode system over an 18px slide.
 *  So an attached fence is FOLDED INTO the run it decorates and only a standalone fence is a
 *  slot of its own; "after this paragraph" then means "after its annotation too", which is the
 *  ownership rule everywhere else in this design.
 *
 *  `minAfterLine` is the note's frontmatter close (0 when it has none). Frontmatter is a run of
 *  non-blank lines like any other, so without this a drop at the very top would splice a fence
 *  ABOVE the opening `---` and turn the note's metadata into body text.
 *
 *  Exported for `drawBlock.test.ts`: the STRUCTURE of the slot list (how many, and which line
 *  each one hands to `planReorder`) is the part that carries the ownership rule, and it can be
 *  asserted headlessly against the height map without any real pixel measurement. */
export function dropSlots(
    view: EditorView,
    dragged: DrawBlock,
): { slots: DropSlot[]; minAfterLine: number } {
    const doc = view.state.doc
    const text = doc.toString()
    const blocks = scanDrawBlocks(text)
    const fenceStart = new Map<number, DrawBlock>()
    const fenceLines = new Set<number>()
    for (const b of blocks) {
        fenceStart.set(b.fromLine, b)
        for (let n = b.fromLine; n <= Math.min(b.toLine, doc.lines); n++) {
            fenceLines.add(n)
        }
    }

    const fm = extractFrontmatterBoundary(text)
    let minAfterLine = 0
    if (fm) {
        const firstBody = doc.lineAt(fm.from).number
        const lastBody =
            fm.to > fm.from ? doc.lineAt(fm.to).number : firstBody - 1
        minAfterLine = Math.min(lastBody + 1, doc.lines)
    }

    const slots: DropSlot[] = []
    let run: { y: number; bottom: number; afterLine: number } | null = null
    const flush = () => {
        if (run) slots.push({ y: run.y, h: run.bottom - run.y, afterLine: run.afterLine })
        run = null
    }

    let pos = 0
    for (;;) {
        const blk = view.lineBlockAt(pos)
        const line = doc.lineAt(blk.from)
        const fence = fenceStart.get(line.number)
        if (line.number <= minAfterLine) {
            flush()
        } else if (fence && !fence.standalone) {
            // An attached fence belongs to the block above it. Extend that block's slot over the
            // fence and hand out the FENCE's last line, so a drop lands after the annotation
            // rather than between the paragraph and its own ink.
            if (run) {
                run = {
                    y: run.y,
                    bottom: blk.bottom,
                    afterLine: fence.toLine,
                }
            } else if (slots.length) {
                // Blank lines between a paragraph and its annotation already closed the run —
                // `attachedToLine` skips blanks, so the fence still decorates that paragraph and
                // the slot it just pushed is the one to extend.
                const prev = slots[slots.length - 1]
                slots[slots.length - 1] = {
                    y: prev.y,
                    h: Math.max(prev.h, blk.bottom - prev.y),
                    afterLine: fence.toLine,
                }
            }
            // With neither, the fence decorates nothing reachable (it opens the body). It
            // contributes no slot at all rather than becoming one.
        } else if (fence || fenceLines.has(line.number)) {
            flush()
            // The block being dragged is not a place it can land.
            if (fence && fence.fromLine !== dragged.fromLine) {
                slots.push({
                    y: blk.top,
                    h: blk.bottom - blk.top,
                    afterLine: fence.toLine,
                })
            }
        } else if (line.text.trim() === '') {
            flush()
        } else {
            const lastLine = doc.lineAt(Math.min(blk.to, doc.length)).number
            run = run
                ? { y: run.y, bottom: blk.bottom, afterLine: lastLine }
                : { y: blk.top, bottom: blk.bottom, afterLine: lastLine }
        }
        if (blk.to >= doc.length) break
        pos = blk.to + 1
    }
    flush()
    return { slots, minAfterLine }
}

/** The line a drop at `clientY` should follow, and where to draw the indicator for it (both in
 *  client coordinates for the caller's convenience). `null` when the document offers nowhere to
 *  put it. */
function resolveDrop(
    view: EditorView,
    dragged: DrawBlock,
    clientY: number,
): { afterLine: number; indicatorY: number } | null {
    const { slots, minAfterLine } = dropSlots(view, dragged)
    if (!slots.length) return null
    const index = insertionIndexForY(slots, clientY - view.documentTop)
    const before = index > 0 ? slots[index - 1] : null
    return {
        afterLine: Math.max(minAfterLine, before ? before.afterLine : minAfterLine),
        indicatorY:
            view.documentTop + (before ? before.y + before.h : slots[0].y),
    }
}

/** The line shown where the drawing would land. Lives on `document.body` at `position: fixed`
 *  rather than inside the editor because the drag can travel outside the scroller, and because a
 *  child of `.cm-content` would be one more thing CodeMirror's own DOM reconciliation has to
 *  tolerate mid-drag. */
function makeIndicator(): HTMLElement {
    const el = document.createElement('div')
    el.dataset.drawDropIndicator = ''
    el.style.position = 'fixed'
    el.style.height = '2px'
    el.style.background = 'var(--accent, currentColor)'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '60'
    document.body.appendChild(el)
    return el
}

class DrawBlockWidget extends WidgetType {
    private ro?: ResizeObserver
    private detach?: () => void

    constructor(
        readonly block: DrawBlock,
        readonly strokes: DrawBlock['strokes'],
        readonly standalone: boolean,
    ) {
        super()
    }

    eq(other: DrawBlockWidget): boolean {
        return (
            other.standalone === this.standalone &&
            other.strokes === this.strokes &&
            other.block.fromLine === this.block.fromLine &&
            other.block.toLine === this.block.toLine
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

    /** Re-read this widget's block from the LIVE document rather than trusting the copy it was
     *  constructed with: a widget's DOM outlives its `eq()` for as long as nothing about it
     *  changed, so `this.block`'s line numbers can be one edit stale by the time a drag starts,
     *  and a stale `fromLine` would move the wrong three lines. */
    private liveBlock(view: EditorView, dom: HTMLElement): DrawBlock | null {
        const blocks = scanDrawBlocks(view.state.doc.toString())
        try {
            const line = view.state.doc.lineAt(view.posAtDOM(dom)).number
            const hit = blocks.find(
                b => b.fromLine <= line && line <= b.toLine,
            )
            if (hit) return hit
        } catch {
            /* the widget is detached mid-drag; fall through to the constructed copy */
        }
        return blocks.find(b => b.fromLine === this.block.fromLine) ?? null
    }

    private startDrag(
        view: EditorView,
        dom: HTMLElement,
        e: PointerEvent,
    ): void {
        // DRAW MODE MAKES THE WHOLE DRAWING INERT. `Editor.tsx`'s `setDraw` reconfigures
        // `EditorView.editable.of(!on)`, so a non-editable view is a view in draw mode, and this
        // press belongs to the ink overlay as a pen stroke. Returning BEFORE `preventDefault()`
        // and before the pointer capture matters as much as returning at all: a consumed or
        // captured event is not a stroke either, so a gate that merely skipped the drag would
        // still swallow the user's ink.
        if (!view.state.facet(EditorView.editable)) return
        if (e.button !== 0) return
        // A second pointerdown while a drag is live (multi-touch, or a stray synthetic event)
        // would arm a second set of window listeners that the first drag's teardown never
        // removes.
        if (this.detach) return
        const block = this.liveBlock(view, dom)
        if (!block) return
        e.preventDefault()
        e.stopPropagation()
        // `:active` is the CSS half of this, but a pointerdown whose default is prevented never
        // produces the compatibility mousedown some engines drive `:active` from, so the state
        // that lasts the whole drag is set here rather than left to the cascade.
        dom.style.cursor = 'grabbing'
        // A synthetic PointerEvent (a story, a test harness) carries no live pointer, so the
        // capture throws; losing it only costs tracking once the cursor leaves the drawing.
        try {
            dom.setPointerCapture(e.pointerId)
        } catch {
            /* no live pointer to capture */
        }

        const indicator = makeIndicator()
        let drop: { afterLine: number; indicatorY: number } | null = null

        const move = (ev: PointerEvent) => {
            drop = resolveDrop(view, block, ev.clientY)
            if (!drop) {
                indicator.style.display = 'none'
                return
            }
            const cr = view.contentDOM.getBoundingClientRect()
            indicator.style.display = 'block'
            indicator.style.left = `${cr.left}px`
            indicator.style.width = `${cr.width}px`
            indicator.style.top = `${drop.indicatorY}px`
        }
        const finish = (commit: boolean) => {
            // Cleared FIRST: the commit below dispatches, which rebuilds the decoration field
            // and destroys this widget — and `destroy()` calls back into here.
            this.detach = undefined
            dom.style.cursor = ''
            indicator.remove()
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
            window.removeEventListener('pointercancel', cancel)
            window.removeEventListener('keydown', key)
            if (!commit || !drop) return
            const before = view.state.doc.toString()
            const after = planReorder(before, block, drop.afterLine)
            if (after === before) return
            view.dispatch({
                changes: { from: 0, to: before.length, insert: after },
                // A block reorder IS a text edit the user made, so unlike an ink commit it
                // belongs in the editor's own undo history.
                userEvent: 'move.drop',
            })
        }
        const up = () => finish(true)
        const cancel = () => finish(false)
        const key = (ev: KeyboardEvent) => {
            if (ev.key === 'Escape') finish(false)
        }

        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', cancel)
        window.addEventListener('keydown', key)
        this.detach = () => finish(false)
        move(e)
    }

    toDOM(view: EditorView): HTMLElement {
        const div = document.createElement('div')
        div.dataset.drawBlock = ''
        if (this.standalone) {
            div.dataset.drawStandalone = ''
            div.className = 'cm-draw-standalone'
            div.style.display = 'block'
            div.style.width = '100%'
            div.style.position = 'relative'
            this.applyHeight(div, view)
            // Keep the reserved height in sync with pane-width changes (sidebar toggle, window
            // resize) — the same fixed-logical-space rescale InkOverlay.tsx does for painted ink.
            this.ro = new ResizeObserver(() => this.applyHeight(div, view))
            this.ro.observe(view.contentDOM)

            // The drag surface is this element, not a child of it: the whole drawing is the
            // handle. `data-draw-drag` stays as the runtime hook naming that surface (stories in
            // DrawBlock.stories.tsx and InkOverlay.stories.tsx grab a drawing through it) — it
            // moved onto the widget rather than being retired, because "the thing you drag" is
            // still a distinct fact about this element from "the thing that reserves height".
            div.dataset.drawDrag = ''
            div.title = 'Drag to move this drawing'
            div.addEventListener('pointerdown', e => this.startDrag(view, div, e))
        }
        return div
    }

    destroy(): void {
        this.ro?.disconnect()
        this.ro = undefined
        // A widget destroyed mid-drag (the document changed under it) must not leave the
        // indicator painted on the page or its window listeners attached.
        this.detach?.()
        this.detach = undefined
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
        const widget = new DrawBlockWidget(b, b.strokes, b.standalone)
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

// The widget is raw DOM built by a CodeMirror widget, not a component, so it is styled the way the
// rest of this extension family styles theirs — an EditorView.theme, which scopes to the editor
// without a global class a CSS Module could later hash out from under it.
//
// THE CURSOR IS THE ENTIRE AFFORDANCE, and these two rules are all of it. The drawing paints
// nothing to advertise that it can be dragged — no background, no border, no hover reveal. The
// user asked for that twice: first "blocks are visible" (a grip at a permanent 25% opacity), then
// again at a hover reveal that still showed a dotted strip whenever the pointer passed over a
// drawing — "i dont like this handle, i told u that it hsould be seemless". Do NOT reintroduce a
// painted marker; if reordering needs to be more discoverable than a hand cursor, that is a
// separate decision about a control somewhere else.
//
// **`.cm-content[contenteditable="true"]` is how draw mode turns the cursor off.** A cursor is a
// hover state with no event to gate in JS, so the gate has to be in the selector, and CodeMirror
// already projects the `editable` facet onto exactly this attribute (`updateAttrs` writes
// `contenteditable: !facet(editable) ? "false" : "true"` on `.cm-content`). It is the same signal
// `startDrag` reads, one hop away, so the hand cannot appear on a drawing that will not drag. An
// attribute selector is also the safe form here: a global rule naming a CSS-Module CLASS hashes
// to a different local and silently matches nothing.
const drawBlockTheme = EditorView.theme({
    '.cm-content[contenteditable="true"] .cm-draw-standalone': {
        cursor: 'grab',
    },
    '.cm-content[contenteditable="true"] .cm-draw-standalone:active': {
        cursor: 'grabbing',
    },
})

/** The CodeMirror extension: hides every ```draw fence and replaces it with an atomic widget
 *  that reserves either zero height (attached) or the ink's own height (standalone), and makes a
 *  standalone one a whole-area drag surface that reorders it among the note's blocks — outside
 *  draw mode only. */
export function drawBlockExtension(): Extension {
    return [
        drawBlockField,
        drawBlockTheme,
        // Make the whole replaced range one atomic unit so ArrowLeft/ArrowRight step OVER the
        // block instead of placing a caret inside the (invisible) fence — the fence must never
        // reveal its source, unlike queryBlock.ts / graphBlock.ts.
        EditorView.atomicRanges.of(view => view.state.field(drawBlockField)),
    ]
}
