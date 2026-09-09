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
import { EditorState } from '@codemirror/state'
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

function mount(doc: string): EditorView {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
        parent,
        state: EditorState.create({ doc, extensions: [drawBlockExtension()] }),
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
