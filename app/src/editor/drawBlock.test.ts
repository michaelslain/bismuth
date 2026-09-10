// app/src/editor/drawBlock.test.ts
//
// Coverage for the non-pure half of the ```draw block — the CodeMirror wiring in
// editor/drawBlock.ts (drawBlockGeometry.test.ts covers the pure geometry). Two things
// drawBlockGeometry.test.ts and blockRegions.test.ts cannot see:
//
//   1. The ATOMIC guarantee. The fence never reveals its raw source (unlike ```query /
//      ```graph), so the only thing standing between a careless edit and a partially deleted,
//      silently corrupted base64 payload is CodeMirror's EditorView.atomicRanges honoring the
//      block's decoration range as one indivisible unit. That needs a REAL EditorView —
//      atomic-range skipping (view.moveByChar, which deleteCharBackward/Forward call
//      internally) is implemented at the view layer, not on EditorState alone — so this file
//      uses the same happy-dom-backed real-EditorView pattern as graphBlock.test.ts and
//      tableWidget.test.ts rather than a plain EditorState. No real browser is involved.
//   2. Multiple draw blocks in one document — the ordinary case (a note with several
//      sketches), not the one-fence fixtures everywhere else in this task.
//
// Mounting uses drawBlockExtension() directly against a real (happy-dom) EditorView; no Solid
// widget content is exercised (the widget is a bare sized <div>, not a mounted component), so
// unlike graphBlock.test.ts there is no Solid/mountSolid mock to install.
import { GlobalWindow } from 'happy-dom'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { deleteCharBackward, deleteCharForward } from '@codemirror/commands'
import { dropSlots, drawBlockExtension } from './drawBlock'
import { encodeStrokes } from '../../../core/src/drawing/inkCodec'
import { scanDrawBlocks } from '../../../core/src/drawing/drawBlocks'
import { planReorder } from './inkCommit'
import type { Stroke } from '../../../core/src/drawing/model'
import { standaloneHeight } from './drawBlockGeometry'

// Same install/restore discipline as graphBlock.test.ts + tableWidget.test.ts: add only the
// globals this file needs (including ResizeObserver — drawBlock.ts's standalone widget uses
// one) and remove exactly those, so a leaked DOM can't leak into the intentionally-headless
// test files sharing this `bun test app` process.
const DOM_GLOBALS = [
    'document',
    'window',
    'navigator',
    'Node',
    'Element',
    'HTMLElement',
    'Text',
    'DocumentFragment',
    'MutationObserver',
    'Range',
    'NodeFilter',
    'DOMParser',
    'HTMLDivElement',
    'HTMLSpanElement',
    'DOMRect',
    'Event',
    'UIEvent',
    'MouseEvent',
    'PointerEvent',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'getSelection',
    'Selection',
]
const installed: string[] = []
const views: EditorView[] = []

// `graph/AsciiGraphRenderer.test.ts`, a sibling suite in this same `bun test app` process,
// saves whatever it finds at ResizeObserver/requestAnimationFrame/cancelAnimationFrame and
// restores by ASSIGNING the saved value back (`globalThis[key] = saved[key]`) instead of
// deleting the key when nothing was there before it ran. When that file runs before this one,
// it leaves `globalThis.ResizeObserver` an OWN PROPERTY set to `undefined` —
// `'ResizeObserver' in globalThis` is then true — so the plain "already present" guard used
// below for every other key would skip installing happy-dom's real constructor here, and
// `new ResizeObserver(...)` in drawBlock.ts would throw "undefined is not a constructor" (this
// bit exactly, the first time this file ran inside the full `bun test app` suite). Test order
// across files is not guaranteed, so these three keys are checked for "usable" (function-typed)
// rather than merely "present". Every key here is still restored via `delete`, never a value
// assignment, so this file cannot inflict the same pollution on whichever suite runs after it.
const FRAGILE_KEYS = new Set([
    'ResizeObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
])

beforeAll(() => {
    const win = new GlobalWindow()
    for (const key of DOM_GLOBALS) {
        const current = (globalThis as Record<string, unknown>)[key]
        const present = FRAGILE_KEYS.has(key)
            ? typeof current === 'function'
            : key in globalThis
        if (!present && key in win) {
            ;(globalThis as Record<string, unknown>)[key] = (
                win as unknown as Record<string, unknown>
            )[key]
            installed.push(key)
        }
    }
})

afterEach(() => {
    for (const v of views.splice(0)) v.destroy()
})

afterAll(() => {
    for (const key of installed) delete (globalThis as Record<string, unknown>)[key]
})

function mount(doc: string, extra: Extension[] = []): EditorView {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
        parent,
        state: EditorState.create({
            doc,
            extensions: [drawBlockExtension(), ...extra],
        }),
    })
    views.push(view)
    return view
}

function ink(): Stroke[] {
    return [{ t: 'pen', c: 'fg', w: 4, pts: [10, 20, 180, 110, 220, 180] }]
}

// ── Deleting across the atomic block never leaves a fragment ──────────────────────────────

describe('deleting across a draw block never leaves a fragment', () => {
    // Attached (no blank line before the fence — see blockRegions.test.ts for why that
    // matters) so both shapes get exercised across this file. No blank line after the fence
    // either, so the ONE newline separating the fence from AFTER (which is what remains once
    // the fence's own lines are excised) is the sole predictable separator in the expected
    // result below.
    const BEFORE = 'The mitochondria is the powerhouse of the cell.'
    const AFTER = 'Text after it.'
    const doc = [BEFORE, '```draw', encodeStrokes(ink()), '```', AFTER].join('\n')

    test('Backspace immediately after the block removes the whole fence, not a fragment', () => {
        const view = mount(doc)
        // Cursor at the very end of the closing ``` line (the boundary right after the block).
        const closeLine = view.state.doc.line(4) // '```' — see `doc` above
        view.dispatch({ selection: { anchor: closeLine.to } })
        const handled = deleteCharBackward(view)
        expect(handled).toBe(true)
        const text = view.state.doc.toString()
        expect(text).not.toContain('```draw')
        expect(text).not.toContain('```')
        // The block is gone ENTIRELY — not a stray closing marker, not a truncated payload.
        expect(text).toBe([BEFORE, '', AFTER].join('\n'))
    })

    test('Delete immediately before the block removes the whole fence, not a fragment', () => {
        const view = mount(doc)
        // Cursor right before the '```draw' line — the boundary right before the block.
        const openLine = view.state.doc.line(2)
        view.dispatch({ selection: { anchor: openLine.from } })
        const handled = deleteCharForward(view)
        expect(handled).toBe(true)
        const text = view.state.doc.toString()
        expect(text).not.toContain('```draw')
        expect(text).not.toContain(encodeStrokes(ink()))
        expect(text).toBe([BEFORE, '', AFTER].join('\n'))
    })

    test('a selection spanning the block, replaced by typed text, leaves no partial fence', () => {
        const view = mount(doc)
        const openLine = view.state.doc.line(2)
        const closeLine = view.state.doc.line(4)
        // Select from just before the fence to just after it (as a keyboard shift-select that
        // started outside the block would land, honoring the atomic boundary) and replace it —
        // simulates "select across the drawing, then type".
        view.dispatch({
            changes: { from: openLine.from, to: closeLine.to, insert: 'X' },
        })
        const text = view.state.doc.toString()
        expect(text).not.toContain('```draw')
        expect(text).not.toContain('```')
        expect(text).toBe([BEFORE, 'X', AFTER].join('\n'))
    })

    test('a selection spanning the block, replaced by a multi-line paste, leaves no partial fence', () => {
        const view = mount(doc)
        const openLine = view.state.doc.line(2)
        const closeLine = view.state.doc.line(4)
        const pasted = 'pasted line one\npasted line two'
        view.dispatch({
            changes: { from: openLine.from, to: closeLine.to, insert: pasted },
        })
        const text = view.state.doc.toString()
        expect(text).not.toContain('```draw')
        expect(text).not.toContain('```')
        expect(text).toBe([BEFORE, pasted, AFTER].join('\n'))
    })
})

// ── Multiple draw blocks in one document ───────────────────────────────────────────────────

describe('multiple draw blocks in one document', () => {
    test('three fences — attached, standalone, attached — each get their own widget with correct marking', () => {
        const smallInk: Stroke[] = [{ t: 'pen', c: 'fg', w: 4, pts: [0, 0, 200, 10, 10, 200] }]
        const bigInk: Stroke[] = [{ t: 'pen', c: 'fg', w: 4, pts: [0, 0, 200, 10, 300, 200] }]
        const doc = [
            'First paragraph, annotated.',
            '```draw', // attached to the paragraph above (no blank line)
            encodeStrokes(smallInk),
            '```',
            '',
            '```draw block', // standalone: says so in its own info string
            encodeStrokes(bigInk),
            '```',
            '',
            'Second paragraph.',
            '```draw', // attached to "Second paragraph." above
            encodeStrokes(smallInk),
            '```',
            '',
            'Outro.',
        ].join('\n')

        const view = mount(doc)
        const blocks = Array.from(
            view.dom.querySelectorAll<HTMLElement>('[data-draw-block]'),
        )
        expect(blocks.length).toBe(3)

        const [first, second, third] = blocks
        expect(first.hasAttribute('data-draw-standalone')).toBe(false)
        expect(second.hasAttribute('data-draw-standalone')).toBe(true)
        expect(third.hasAttribute('data-draw-standalone')).toBe(false)

        // Attached blocks reserve zero height regardless of how much ink they carry — drawBlock.ts
        // never sets an inline height for them at all. happy-dom has no real layout engine (every
        // element's getBoundingClientRect() reads back as all zeros regardless of inline style,
        // even a set one — see the standalone assertion below, which is why this suite checks the
        // inline `style.height` string rather than a measured box).
        expect(first.style.height).toBe('')
        expect(third.style.height).toBe('')

        // The standalone block reserves the ink's own height (scale defaults to 1 when the
        // (happy-dom) contentDOM reports a zero-width layout — see drawBlock.ts's
        // `currentScale`), matching standaloneHeight's pure computation directly.
        const expectedLogicalHeight = standaloneHeight(bigInk, 24) // STANDALONE_PAD
        const width = view.contentDOM.getBoundingClientRect().width
        const scale = width > 0 ? width / 680 : 1
        expect(second.style.height).toBe(`${expectedLogicalHeight * scale}px`)
        // And it differs from a zero-ink block's height — the marking isn't just cosmetic.
        expect(expectedLogicalHeight).toBeGreaterThan(0)
    })

    // A fence's mode is its own info string, so two fences in identical surroundings can differ
    // — and, more importantly, an ATTACHED fence stays attached however much blank space ends up
    // above it. That whitespace used to decide the mode, which meant one Enter keypress at the
    // end of an annotated paragraph re-read its stored geometry under the standalone rule and
    // threw the annotation 78px down the page into a newly reserved box.
    test('surrounding blank lines do not change either fence mode', () => {
        const doc = [
            'A paragraph.',
            '',
            '',
            '```draw',
            encodeStrokes(ink()),
            '```',
            '',
            '```draw block',
            encodeStrokes(ink()),
            '```',
        ].join('\n')

        const view = mount(doc)
        const blocks = Array.from(
            view.dom.querySelectorAll<HTMLElement>('[data-draw-block]'),
        )
        expect(blocks.length).toBe(2)
        expect(blocks[0].hasAttribute('data-draw-standalone')).toBe(false)
        expect(blocks[1].hasAttribute('data-draw-standalone')).toBe(true)
        // The attached one reserves nothing even though a blank line sits above it.
        expect(blocks[0].style.height).toBe('')
    })
})

// ── Where a dragged drawing is allowed to land ───────────────────────────────────────────
//
// `dropSlots` is exported for this: the slot list's STRUCTURE is what carries the ownership
// rule, and it comes out of CodeMirror's height map rather than any real measurement, so it can
// be asserted headlessly. The pixel values here are estimates (happy-dom measures nothing) and
// are deliberately never asserted on — only the count and the `afterLine` each slot hands to
// `planReorder`.

const PAYLOAD = encodeStrokes(ink())

/** The 1-based line a slot's `afterLine` names, as text — far more legible in a failure than a
 *  number, and it is the exact thing that goes wrong when a slot is placed inside a block. */
const ownerText = (view: EditorView, n: number) => view.state.doc.line(n).text

describe('dropSlots', () => {
    // Alpha / Beta+its annotation / Gamma / the standalone drawing being dragged / Delta.
    const NOTE = [
        'Alpha paragraph.',
        '',
        'Beta paragraph, the annotated one.',
        '```draw',
        PAYLOAD,
        '```',
        '',
        'Gamma paragraph.',
        '',
        '```draw block',
        PAYLOAD,
        '```',
        '',
        'Delta paragraph.',
        '',
    ].join('\n')

    const dragged = (view: EditorView) =>
        scanDrawBlocks(view.state.doc.toString()).find(b => b.standalone)!

    // THE regression. An attached fence used to be its own landing site, so a drop "after Beta"
    // went between Beta and its own annotation and re-parented the annotation onto the drawing.
    test('a paragraph and its attached annotation are ONE slot', () => {
        const view = mount(NOTE)
        const { slots } = dropSlots(view, dragged(view))
        // Alpha, Beta+annotation, Gamma, Delta — the dragged drawing is not a place it can land.
        expect(slots).toHaveLength(4)
        expect(slots.map(s => ownerText(view, s.afterLine))).toEqual([
            'Alpha paragraph.',
            // Beta's slot hands out its ANNOTATION's last line, not its prose line…
            '```',
            'Gamma paragraph.',
            'Delta paragraph.',
        ])
        // …and that line really is the annotation's closing fence, not some other backtick.
        const annotation = scanDrawBlocks(view.state.doc.toString()).find(
            b => !b.standalone,
        )!
        expect(slots[1].afterLine).toBe(annotation.toLine)
    })

    // The end the slot exists to serve: a drop after that slot leaves the annotation owned by
    // the paragraph it was drawn on.
    test('dropping after the annotated paragraph does not steal its annotation', () => {
        const view = mount(NOTE)
        const drag = dragged(view)
        const { slots } = dropSlots(view, drag)
        const before = view.state.doc.toString()
        const annotationBefore = scanDrawBlocks(before).find(b => !b.standalone)!
        expect(
            before.split('\n')[annotationBefore.attachedToLine! - 1],
        ).toContain('Beta')

        const after = planReorder(before, drag, slots[1].afterLine)
        expect(after).not.toBe(before)
        const annotationAfter = scanDrawBlocks(after).find(b => !b.standalone)!
        expect(
            after.split('\n')[annotationAfter.attachedToLine! - 1],
        ).toContain('Beta')
        // And the drawing really did move: it now sits below the annotation.
        const drawingAfter = scanDrawBlocks(after).find(b => b.standalone)!
        expect(drawingAfter.fromLine).toBeGreaterThan(annotationAfter.toLine)
    })

    // The counterexample that shows the slot's `afterLine` is load-bearing rather than
    // decorative: hand `planReorder` the PROSE line instead and the annotation is re-parented.
    test('dropping between a paragraph and its annotation is what steals it', () => {
        const view = mount(NOTE)
        const before = view.state.doc.toString()
        const betaLine = before.split('\n').findIndex(l => l.startsWith('Beta')) + 1
        const after = planReorder(before, dragged(view), betaLine)
        const annotation = scanDrawBlocks(after).find(b => !b.standalone)!
        expect(
            after.split('\n')[annotation.attachedToLine! - 1],
        ).not.toContain('Beta')
    })

    test('a standalone drawing is a slot of its own, and the dragged one is not', () => {
        const TWO = [
            'Alpha paragraph.',
            '',
            '```draw block',
            PAYLOAD,
            '```',
            '',
            '```draw block',
            PAYLOAD,
            '```',
            '',
            'Beta paragraph.',
            '',
        ].join('\n')
        const view = mount(TWO)
        const blocks = scanDrawBlocks(view.state.doc.toString())
        const { slots } = dropSlots(view, blocks[0])
        // Alpha, the OTHER drawing, Beta.
        expect(slots).toHaveLength(3)
        expect(slots[1].afterLine).toBe(blocks[1].toLine)
        // Dragging the second one instead swaps which drawing is excluded.
        const other = dropSlots(view, blocks[1]).slots
        expect(other).toHaveLength(3)
        expect(other[1].afterLine).toBe(blocks[0].toLine)
    })

    test('frontmatter is never a landing site and never a slot', () => {
        const FM = [
            '---',
            'title: A note',
            'tags: [x]',
            '---',
            '',
            'Alpha paragraph.',
            '',
            '```draw block',
            PAYLOAD,
            '```',
            '',
        ].join('\n')
        const view = mount(FM)
        const { slots, minAfterLine } = dropSlots(view, dragged(view))
        // Only Alpha — the frontmatter run contributes nothing.
        expect(slots).toHaveLength(1)
        expect(ownerText(view, slots[0].afterLine)).toBe('Alpha paragraph.')
        // …and the earliest a drop may land is after the closing `---`, so a drop at the very
        // top cannot splice a fence above it and turn the metadata into body text.
        expect(minAfterLine).toBe(4)
        expect(ownerText(view, minAfterLine)).toBe('---')
    })

    test('an annotation separated from its paragraph by blank lines still folds into it', () => {
        // `attachedToLine` skips blanks, so this fence still decorates Alpha — and the slot has
        // to follow it there, or the same theft happens one blank line further down.
        const GAPPED = [
            'Alpha paragraph.',
            '',
            '```draw',
            PAYLOAD,
            '```',
            '',
            '```draw block',
            PAYLOAD,
            '```',
            '',
        ].join('\n')
        const view = mount(GAPPED)
        const annotation = scanDrawBlocks(view.state.doc.toString()).find(
            b => !b.standalone,
        )!
        expect(
            view.state.doc.line(annotation.attachedToLine!).text,
        ).toContain('Alpha')
        const { slots } = dropSlots(view, dragged(view))
        expect(slots).toHaveLength(1)
        expect(slots[0].afterLine).toBe(annotation.toLine)
    })
})

// ── The whole drawing is the drag surface, and only outside draw mode ─────────────────────
//
// The reorder drag used to start on a 14px invisible strip down the drawing's left edge. Nobody
// could find it, so the whole drawing is the handle now and the CURSOR is the affordance. Two
// halves, and the second is the dangerous one:
//
//   1. Pointer-down ANYWHERE on a standalone drawing starts the same drag, with the same drop
//      indicator and the same landing rules `dropSlots`/`planReorder` already implement.
//   2. In DRAW MODE the drawing is inert — a pointer-down there is a pen stroke and must stay
//      one. Getting this backwards makes it impossible to draw on top of an existing drawing,
//      which is worse than the discoverability problem being fixed.
//
// Draw mode is `EditorView.editable` being false: `Editor.tsx`'s `setDraw` reconfigures
// `EditorView.editable.of(!on)` in a Compartment, so a non-editable view IS a view in draw mode.
// These tests set the same facet statically, which is the identical signal the widget reads.
//
// **Every test below is PAIRED.** Asserting only "in draw mode nothing happens" passes against
// code with no whole-area listener at all — i.e. against the state this feature started from —
// so each inert case also drives the SAME gesture against an editable view and requires it to
// move the drawing. One arm fails if the feature is missing; the other fails if the mode check
// is removed.
//
// happy-dom has no layout engine, so "the middle of the drawing" here means "the widget element
// itself" — the geometric half (a press at the drawing's centre, far from its left edge, really
// hitting the drag surface) is asserted in a real browser by DrawBlock.stories.tsx's
// `WholeDrawingDrags` / `DrawModeIsInert`.

/** A PointerEvent when the DOM has one, else a MouseEvent carrying the same fields. The widget's
 *  handler reads `button`, `clientY` and `pointerId`; `setPointerCapture` already tolerates a
 *  synthetic event (no live pointer to capture) and swallows the throw. */
function pointerEvent(type: string, clientY: number): Event {
    const init = {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 40,
        clientY,
        pointerId: 21,
    }
    const Ctor = (globalThis as Record<string, unknown>).PointerEvent as
        | (new (t: string, i: Record<string, unknown>) => Event)
        | undefined
    return Ctor ? new Ctor(type, init) : new MouseEvent(type, init)
}

const dropIndicator = () =>
    document.querySelector('[data-draw-drop-indicator]')

describe('the whole drawing is the drag surface', () => {
    // Alpha / Beta + its attached annotation / the standalone drawing / Gamma. Both widget
    // shapes are reachable from one mount, so the attached case can be checked against the
    // standalone one in the very same document.
    const NOTE = [
        'Alpha paragraph.',
        '',
        'Beta paragraph, the annotated one.',
        '```draw',
        PAYLOAD,
        '```',
        '',
        '```draw block',
        PAYLOAD,
        '```',
        '',
        'Gamma paragraph.',
        '',
    ].join('\n')

    const standaloneWidget = (view: EditorView) =>
        view.dom.querySelector<HTMLElement>(
            '[data-draw-block][data-draw-standalone]',
        )!
    const attachedWidget = (view: EditorView) =>
        view.dom.querySelector<HTMLElement>(
            '[data-draw-block]:not([data-draw-standalone])',
        )!
    const drawing = (view: EditorView) =>
        scanDrawBlocks(view.state.doc.toString()).find(b => b.standalone)!

    /** The last slot in the note, and the clientY that aims a drop at it. `resolveDrop` reads
     *  `clientY - view.documentTop`, and happy-dom's `documentTop` is 0, so this is the height
     *  map's own coordinate — no real measurement involved. */
    const lastSlot = (view: EditorView) => {
        const { slots } = dropSlots(view, drawing(view))
        const last = slots[slots.length - 1]
        return { afterLine: last.afterLine, y: view.documentTop + last.y + last.h - 1 }
    }

    /** Press, move, release — the gesture, returned so a caller can ask whether the press was
     *  consumed. */
    const drag = (el: HTMLElement, toY: number) => {
        const down = pointerEvent('pointerdown', toY)
        el.dispatchEvent(down)
        const raisedIndicator = dropIndicator() !== null
        window.dispatchEvent(pointerEvent('pointermove', toY))
        window.dispatchEvent(pointerEvent('pointerup', toY))
        return { down, raisedIndicator }
    }

    test('pointer-down in the middle of a standalone drawing raises the drop indicator', () => {
        const view = mount(NOTE)
        expect(dropIndicator()).toBeNull()
        const down = pointerEvent('pointerdown', lastSlot(view).y)
        standaloneWidget(view).dispatchEvent(down)
        const el = dropIndicator() as HTMLElement | null
        expect(el).not.toBeNull()
        // Up, not hidden: `move()` hides it when the document offers nowhere to land, so a
        // displayed indicator is what proves a real drop was resolved.
        expect(el!.style.display).toBe('block')
        // The press was consumed, so it cannot also become a caret placement or a text selection.
        expect(down.defaultPrevented).toBe(true)
        // …and the cursor says so for the whole drag. `:active` is the CSS half, but a
        // pointerdown whose default is prevented never reaches it on some engines, so the state
        // is written inline and taken back off on release.
        expect(standaloneWidget(view).style.cursor).toBe('grabbing')
        window.dispatchEvent(pointerEvent('pointercancel', 0))
        expect(dropIndicator()).toBeNull()
        expect(standaloneWidget(view).style.cursor).toBe('')
    })

    test('a completed drag from the middle of the drawing lands it exactly where planReorder says', () => {
        const view = mount(NOTE)
        const before = view.state.doc.toString()
        const block = drawing(view)
        const target = lastSlot(view)
        drag(standaloneWidget(view), target.y)

        // Byte for byte the same document the existing landing rules produce for that slot —
        // this drag reuses `dropSlots` + `planReorder`, it does not reimplement them.
        const expected = planReorder(before, block, target.afterLine)
        expect(expected).not.toBe(before)
        expect(view.state.doc.toString()).toBe(expected)
        // And the payload survived the move untouched: a reorder is line surgery, never a
        // re-encode.
        expect(view.state.doc.toString()).toContain(PAYLOAD)
        expect(scanDrawBlocks(view.state.doc.toString()).find(b => b.standalone)!.strokes).toEqual(ink())
        // The indicator came down with the drop.
        expect(dropIndicator()).toBeNull()
    })

    // THE test the whole feature is at risk from. A pointer-down on a drawing while draw mode is
    // on has to stay a pen stroke: unprevented, unconsumed, and moving nothing.
    test('in draw mode the drawing is inert — the same gesture that drags it outside draw mode does nothing', () => {
        // Arm 1, the control: an editable view. Without this the assertions below pass against a
        // widget that has no whole-area listener at all.
        const editable = mount(NOTE)
        const movedBefore = editable.state.doc.toString()
        const moved = drag(standaloneWidget(editable), lastSlot(editable).y)
        expect(moved.raisedIndicator).toBe(true)
        expect(editable.state.doc.toString()).not.toBe(movedBefore)

        // Arm 2, the subject: the same note with draw mode on.
        const inert = mount(NOTE, [EditorView.editable.of(false)])
        const before = inert.state.doc.toString()
        const gesture = drag(standaloneWidget(inert), lastSlot(inert).y)
        expect(gesture.raisedIndicator).toBe(false)
        expect(dropIndicator()).toBeNull()
        // Not merely "no drag": the event must still be live for the ink overlay to make a
        // stroke out of it.
        expect(gesture.down.defaultPrevented).toBe(false)
        expect(inert.state.doc.toString()).toBe(before)
    })

    test('an attached drawing is not a drag surface, while the standalone one beside it is', () => {
        const view = mount(NOTE)
        // Arm 1, the control: the standalone drawing in this very document does drag.
        const movedBefore = view.state.doc.toString()
        expect(drag(standaloneWidget(view), lastSlot(view).y).raisedIndicator).toBe(true)
        expect(view.state.doc.toString()).not.toBe(movedBefore)

        // Arm 2: the attached fence is owned by the paragraph above it — dragging it alone would
        // hand its ink to a different paragraph, which the ownership model forbids.
        const fresh = mount(NOTE)
        const before = fresh.state.doc.toString()
        const gesture = drag(attachedWidget(fresh), lastSlot(fresh).y)
        expect(gesture.raisedIndicator).toBe(false)
        expect(dropIndicator()).toBeNull()
        expect(gesture.down.defaultPrevented).toBe(false)
        expect(fresh.state.doc.toString()).toBe(before)
    })
})
