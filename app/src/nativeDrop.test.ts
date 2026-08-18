import { test, expect, describe } from 'bun:test'
import { pointInDropRect, type DropRect } from './nativeDrop'

// The native OS-file drop is a WINDOW-level event that every surface (chat / editor / terminal)
// receives; each must decide whether the drop at (x,y) belongs to IT. pointInDropRect IS that
// routing decision — verified here without a DOM so the "which pane claims the drop" logic is
// pinned. File-kind classification for that same native path moved to fileIntake.ts (shared with
// the paste surfaces) and is covered by fileIntake.test.ts.

const rect = (
    left: number,
    top: number,
    width: number,
    height: number,
): DropRect => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
})

describe('pointInDropRect (which pane claims a native drop)', () => {
    test('inside → true', () => {
        expect(pointInDropRect(rect(100, 100, 200, 200), 150, 150)).toBe(true)
    })

    test('on the edges is inclusive', () => {
        const r = rect(100, 100, 200, 200) // right=300, bottom=300
        expect(pointInDropRect(r, 100, 100)).toBe(true)
        expect(pointInDropRect(r, 300, 300)).toBe(true)
    })

    test('outside on any side → false', () => {
        const r = rect(100, 100, 200, 200)
        expect(pointInDropRect(r, 99, 150)).toBe(false) // left of
        expect(pointInDropRect(r, 301, 150)).toBe(false) // right of
        expect(pointInDropRect(r, 150, 99)).toBe(false) // above
        expect(pointInDropRect(r, 150, 301)).toBe(false) // below
    })

    test('a 0×0 rect (a hidden display:none pane) is NEVER inside — even at the origin', () => {
        // A backgrounded pane collapses to a 0×0 rect at (0,0); a drop with no position is forwarded at
        // (0,0). Without the guard EVERY hidden pane would claim it — so this must be false.
        expect(pointInDropRect(rect(0, 0, 0, 0), 0, 0)).toBe(false)
    })

    test('routing: three non-overlapping panes → exactly the one under the cursor claims the drop', () => {
        const chat = rect(0, 0, 400, 800)
        const editor = rect(400, 0, 400, 400)
        const terminal = rect(400, 400, 400, 400)
        const x = 500,
            y = 200 // over the editor
        expect(pointInDropRect(chat, x, y)).toBe(false)
        expect(pointInDropRect(editor, x, y)).toBe(true)
        expect(pointInDropRect(terminal, x, y)).toBe(false)
    })
})
