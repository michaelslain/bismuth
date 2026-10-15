import { describe, expect, test } from 'bun:test'
import { inputInset, overlayOrigin } from './kanbanAddColumnOverlay'

describe('overlayOrigin', () => {
    // The numbers measured headless on the add-column story: ghost at (16,16), the "column" glyph
    // box at (50.6,28.45) 12px tall, a TextInput with 4px padding and an 18px line.
    const ghost = { left: 16, top: 16, height: 42.5 }
    const glyph = { left: 50.6, top: 28.45, height: 12 }
    const inset = { left: 4, top: 4, contentHeight: 18 }

    test('x is owned by the flex row: the offset is 0 whatever the glyph x', () => {
        expect(overlayOrigin(ghost, glyph, inset).left).toBe(0)
        expect(
            overlayOrigin(ghost, { ...glyph, left: glyph.left + 9 }, inset)
                .left,
        ).toBe(0)
    })

    test('input text centre lands on the glyph centre', () => {
        // the field is top-anchored on the ghost; the offset closes the rest of the gap
        const o = overlayOrigin(ghost, glyph, inset)
        const inputCentre =
            ghost.top + o.top + inset.top + inset.contentHeight / 2
        expect(inputCentre).toBeCloseTo(glyph.top + glyph.height / 2)
    })

    test('follows the trigger when its vertical geometry moves', () => {
        const a = overlayOrigin(ghost, glyph, inset)
        const b = overlayOrigin(ghost, { ...glyph, top: glyph.top + 3 }, inset)
        expect(b.top - a.top).toBeCloseTo(3)
    })
})

describe('inputInset', () => {
    test('text starts after padding + border; the content box is what the height leaves', () => {
        const cs = {
            paddingLeft: '4px',
            paddingTop: '4px',
            paddingBottom: '4px',
            borderLeftWidth: '1px',
            borderTopWidth: '0px',
            borderBottomWidth: '1px',
        }
        expect(inputInset(cs, 27)).toEqual({
            left: 5,
            top: 4,
            contentHeight: 18,
        })
    })
    test('an unparsable length counts as zero', () => {
        const cs = {
            paddingLeft: '',
            paddingTop: 'auto',
            paddingBottom: '0px',
            borderLeftWidth: 'medium',
            borderTopWidth: '',
            borderBottomWidth: '',
        }
        expect(inputInset(cs, 20)).toEqual({
            left: 0,
            top: 0,
            contentHeight: 20,
        })
    })
})
