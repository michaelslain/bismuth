import { describe, expect, test } from 'bun:test'
import { edgeHandleView } from './edgeHandleLogic'

describe('edgeHandleView', () => {
    // The whole truth table, written out: a chevron points the way the panel's inner edge moves.
    test.each([
        // panel, edge, open -> direction, buttonSide
        ['sidebar', 'left', true, 'left', 'right'],
        ['sidebar', 'left', false, 'right', 'right'],
        ['sidebar', 'right', true, 'right', 'left'],
        ['sidebar', 'right', false, 'left', 'left'],
        ['tab rail', 'right', true, 'right', 'left'],
        ['tab rail', 'right', false, 'left', 'left'],
        ['tab rail', 'left', true, 'left', 'right'],
        ['tab rail', 'left', false, 'right', 'right'],
    ] as const)('%s on the %s, open=%s', (panel, edge, open, direction, buttonSide) => {
        const v = edgeHandleView(panel, edge, open)
        expect(v.direction).toBe(direction)
        expect(v.buttonSide).toBe(buttonSide)
    })

    test('the toggle is named for what it will do, not what it is', () => {
        expect(edgeHandleView('sidebar', 'left', true).action).toBe('hide sidebar')
        expect(edgeHandleView('sidebar', 'left', false).action).toBe('show sidebar')
        expect(edgeHandleView('tab rail', 'right', true).action).toBe('unpin tab rail')
        expect(edgeHandleView('tab rail', 'right', false).action).toBe('pin tab rail')
    })

    test('the strip is named for its panel', () => {
        expect(edgeHandleView('sidebar', 'left', true).label).toBe('sidebar edge')
        expect(edgeHandleView('tab rail', 'left', false).label).toBe('tab rail edge')
    })

    // The button always opens over the editor, never over the panel: opposite the panel's edge, in
    // every state — and never the same side as the chevron's direction when the panel is open.
    test('the button opens away from the panel in every state', () => {
        for (const edge of ['left', 'right'] as const)
            for (const open of [true, false])
                expect(edgeHandleView('sidebar', edge, open).buttonSide).not.toBe(edge)
    })
})
