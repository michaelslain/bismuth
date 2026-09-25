import { describe, expect, test } from 'bun:test'
import { overlayOrigin } from './kanbanAddColumnOverlay'

describe('overlayOrigin', () => {
    // The numbers measured headless on the add-column story: ghost at (16,16), the "column" glyph
    // box at (50.6,28.45) 12px tall, a TextInput with 4px padding and an 18px line.
    const ghost = { left: 16, top: 16, height: 42.5 }
    const glyph = { left: 50.6, top: 28.45, height: 12 }
    const inset = { left: 4, top: 4, contentHeight: 18 }

    test('input text x lands on the glyph x', () => {
        const o = overlayOrigin(ghost, glyph, inset)
        expect(ghost.left + o.left + inset.left).toBeCloseTo(glyph.left)
    })

    test('input text centre lands on the glyph centre', () => {
        const o = overlayOrigin(ghost, glyph, inset)
        const inputGlyphTop = ghost.top + o.top + inset.top + (inset.contentHeight - glyph.height) / 2
        expect(inputGlyphTop).toBeCloseTo(glyph.top)
    })

    test('follows the trigger when its leading geometry moves', () => {
        const a = overlayOrigin(ghost, glyph, inset)
        const b = overlayOrigin(ghost, { ...glyph, left: glyph.left + 4, top: glyph.top + 3 }, inset)
        expect(b.left - a.left).toBeCloseTo(4)
        expect(b.top - a.top).toBeCloseTo(3)
    })
})
