import { test, expect } from 'bun:test'
import { createDrawingStore } from './store'
import { emptyDoc } from '../../../core/src/drawing/model'

const stroke = () => ({
    t: 'pen' as const,
    c: 'fg',
    w: 4,
    pts: [0, 0, 255, 5, 5, 255],
})

test('commitStroke appends to the active page; undo/redo move through history', () => {
    const s = createDrawingStore(emptyDoc(), () => {})
    s.commitStroke(0, stroke())
    expect(s.doc().pages[0].strokes.length).toBe(1)
    s.undo()
    expect(s.doc().pages[0].strokes.length).toBe(0)
    s.redo()
    expect(s.doc().pages[0].strokes.length).toBe(1)
})

test('addPage appends an empty page', () => {
    const s = createDrawingStore(emptyDoc(), () => {})
    s.addPage()
    expect(s.doc().pages.length).toBe(2)
})

test('a mutation requests a save', () => {
    let saves = 0
    const s = createDrawingStore(emptyDoc(), () => {
        saves++
    })
    s.commitStroke(0, stroke())
    expect(saves).toBe(1)
})

// ── mapStrokes: the NON-UNDOABLE rewrite ────────────────────────────────────────────────────
// InkOverlay remaps every stroke's line anchor through every document change (a line inserted
// above must move the ink down with the text). That is bookkeeping, not a user edit: it must
// never land on the undo stack, and it must rewrite the stack's OWN entries too — otherwise
// one Ctrl+Z after typing resurrects a doc whose anchors point at pre-edit positions.

test('mapStrokes rewrites the current strokes WITHOUT pushing an undo entry', () => {
    const s = createDrawingStore(emptyDoc(), () => {})
    s.commitStroke(0, stroke())
    s.mapStrokes(0, st => ({ ...st, w: 99 }))
    expect(s.doc().pages[0].strokes[0].w).toBe(99)
    // One undo = one user action. The map must NOT be that action.
    s.undo()
    expect(s.doc().pages[0].strokes.length).toBe(0)
})

test('mapStrokes rewrites history too, so undo cannot resurrect a stale stroke', () => {
    const s = createDrawingStore(emptyDoc(), () => {})
    s.commitStroke(0, stroke())
    s.commitStroke(0, stroke())
    s.mapStrokes(0, st => ({ ...st, w: 99 }))
    s.undo()
    expect(s.doc().pages[0].strokes.length).toBe(1)
    expect(s.doc().pages[0].strokes[0].w).toBe(99)
    s.redo()
    expect(s.doc().pages[0].strokes.map(x => x.w)).toEqual([99, 99])
})

test('a mapStrokes that changes nothing is a no-op: no new doc, no save', () => {
    let saves = 0
    const s = createDrawingStore(emptyDoc(), () => {
        saves++
    })
    s.commitStroke(0, stroke())
    saves = 0
    const before = s.doc()
    expect(s.mapStrokes(0, st => st)).toBe(false)
    expect(s.doc()).toBe(before)
    expect(saves).toBe(0)
})

test('a mapStrokes that changes something requests a save', () => {
    let saves = 0
    const s = createDrawingStore(emptyDoc(), () => {
        saves++
    })
    s.commitStroke(0, stroke())
    saves = 0
    expect(s.mapStrokes(0, st => ({ ...st, w: 99 }))).toBe(true)
    expect(saves).toBe(1)
})
