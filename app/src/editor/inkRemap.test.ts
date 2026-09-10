// app/src/editor/inkRemap.test.ts
//
// The other half of "a pending op is addressed by something that survives an edit". inkCommit's
// tests pin what a plan does with a reference; these pin that the reference is still right by the
// time the plan sees it.
//
// Every case here is a REAL ChangeSet, built the way CodeMirror builds one, so what is asserted
// is the mapping the update listener actually performs — not a hand-rolled "add one to the line
// number" that would agree with the implementation by construction and with nothing else.
import { describe, expect, test } from 'bun:test'
import { ChangeSet, Text } from '@codemirror/state'
import { remapAnchorLine, remapSeams } from './inkRemap'
import type { Seam } from './inkCommit'

const NOTE = [
    'First paragraph.', // 1
    '', // 2
    '```draw', // 3
    'PAYLOAD', // 4
    '```', // 5
    '', // 6
    'Second paragraph.', // 7
    '', // 8
].join('\n')

const FENCE_LINE = 3

/** A document plus one change against it, as `{before, after, changes}` — the exact three values
 *  CodeMirror's update listener hands over (`u.startState.doc`, `u.state.doc`, `u.changes`). */
function edit(
    text: string,
    spec: { from: number; to?: number; insert?: string },
) {
    const before = Text.of(text.split('\n'))
    const changes = ChangeSet.of(spec, before.length)
    return { before, after: changes.apply(before), changes }
}

/** The position at the start of a 1-based line, for building a change that targets it. */
const startOf = (text: string, line: number) =>
    Text.of(text.split('\n')).line(line).from

describe('remapAnchorLine — a fence reference through a foreign edit', () => {
    test('a line inserted ABOVE the fence moves the reference down with it', () => {
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            insert: 'A line another writer added.\n',
        })
        expect(remapAnchorLine(changes, before, after, FENCE_LINE)).toBe(
            FENCE_LINE + 1,
        )
        // …and that IS where the fence is now, so the mapping is not merely self-consistent.
        expect(after.line(FENCE_LINE + 1).text).toBe('```draw')
    })

    test('a line inserted BELOW the fence leaves the reference exactly where it was', () => {
        const { before, after, changes } = edit(NOTE, {
            from: startOf(NOTE, 7),
            insert: 'Appended by another writer.\n',
        })
        expect(remapAnchorLine(changes, before, after, FENCE_LINE)).toBe(
            FENCE_LINE,
        )
        expect(after.line(FENCE_LINE).text).toBe('```draw')
    })

    test('several lines deleted above shift the reference up by exactly that many', () => {
        // Delete lines 1-2 ('First paragraph.' and the blank after it).
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            to: startOf(NOTE, 3),
        })
        expect(remapAnchorLine(changes, before, after, FENCE_LINE)).toBe(1)
        expect(after.line(1).text).toBe('```draw')
    })

    test('text inserted at the fence line START does not steal the reference', () => {
        // The forward association. A writer inserting a whole line in the slot the fence
        // occupies must push the reference along, not leave it pointing at their own text.
        const { before, after, changes } = edit(NOTE, {
            from: startOf(NOTE, FENCE_LINE),
            insert: 'Squeezed in.\n',
        })
        const line = remapAnchorLine(changes, before, after, FENCE_LINE)
        expect(after.line(line!).text).toBe('```draw')
        expect(after.line(FENCE_LINE).text).toBe('Squeezed in.')
    })

    test('a deletion straight across the fence reports null rather than a nearby line', () => {
        // Lines 1 through 5 gone: the fence no longer exists anywhere. Returning a plausible
        // line here is how an erase gets applied to whatever moved into the slot.
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            to: startOf(NOTE, 6),
        })
        expect(remapAnchorLine(changes, before, after, FENCE_LINE)).toBeNull()
    })

    test('a line that was never in the document reports null', () => {
        const { before, after, changes } = edit(NOTE, { from: 0, insert: 'x' })
        expect(remapAnchorLine(changes, before, after, 0)).toBeNull()
        expect(remapAnchorLine(changes, before, after, 999)).toBeNull()
    })
})

describe('remapSeams — a pen-down seam table through a foreign edit', () => {
    /** The table InkOverlay captures for NOTE: paragraph one, then paragraph two. */
    const table = (): Seam[] => [
        { y: 100, afterLine: 1, origin: 10, scale: 2, standalone: false },
        { y: 300, afterLine: 7, origin: 260, scale: 2, standalone: false },
    ]

    test('every afterLine follows its own line down a shift', () => {
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            insert: 'A line another writer added.\n',
        })
        const out = remapSeams(changes, before, after, table())
        expect(out.map(s => s.afterLine)).toEqual([2, 8])
        expect(after.line(2).text).toBe('First paragraph.')
        expect(after.line(8).text).toBe('Second paragraph.')
    })

    test('a shift BELOW the first band moves only the band below it', () => {
        const { before, after, changes } = edit(NOTE, {
            from: startOf(NOTE, 6),
            insert: 'Wedged in the middle.\n',
        })
        expect(
            remapSeams(changes, before, after, table()).map(s => s.afterLine),
        ).toEqual([1, 8])
    })

    test('THE GEOMETRY IS NOT REMAPPED — only the address is', () => {
        // The load-bearing negative. A pending stroke's y was captured in the same layout as
        // `origin`, so a line shift moves the block and the ink together and the stored offset
        // `y * scale - origin` is unchanged. Touching `origin` here would be the drift the
        // coordinate contract exists to prevent, and it would be invisible in any test that
        // only counted fences.
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            insert: 'A line another writer added.\n',
        })
        const out = remapSeams(changes, before, after, table())
        expect(out.map(s => [s.y, s.origin, s.scale, s.standalone])).toEqual(
            table().map(s => [s.y, s.origin, s.scale, s.standalone]),
        )
    })

    test('a band whose line was deleted is kept, not dropped', () => {
        // A hole in the table would silently re-band every stroke below it, turning a
        // misplaced fence into a whole misplaced drawing. `writeBand`'s own last-content guard
        // is what sanity-checks where the collapsed anchor points.
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            to: startOf(NOTE, 3),
        })
        const out = remapSeams(changes, before, after, table())
        expect(out).toHaveLength(2)
        expect(out.every(s => s.afterLine >= 1)).toBe(true)
    })

    test('"the top of the note" stays the top of the note', () => {
        const { before, after, changes } = edit(NOTE, {
            from: 0,
            insert: 'A line another writer added.\n',
        })
        const out = remapSeams(changes, before, after, [
            { y: 50, afterLine: 0, origin: 0, scale: 1, standalone: true },
        ])
        expect(out[0].afterLine).toBe(0)
    })

    test('text appended after a band is not swallowed into it', () => {
        // The backward association. Somebody typing a fresh paragraph at the end of the note
        // must not become the block the pending ink attaches to.
        const { before, after, changes } = edit(NOTE, {
            from: Text.of(NOTE.split('\n')).line(7).to,
            insert: '\n\nA paragraph another writer started.',
        })
        const out = remapSeams(changes, before, after, table())
        expect(after.line(out[1].afterLine).text).toBe('Second paragraph.')
    })
})
