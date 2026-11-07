import { describe, expect, test } from 'bun:test'
import { createOutsidePress } from './outsidePress'

const PANEL = { id: 'panel' } as unknown as EventTarget
const BACKDROP = { id: 'backdrop' } as unknown as EventTarget
const isInside = (t: EventTarget | null) => t === PANEL

describe('createOutsidePress', () => {
    test('press and release on the backdrop is an outside click', () => {
        const p = createOutsidePress(isInside)
        p.down(BACKDROP)
        expect(p.isOutsideClick(BACKDROP)).toBe(true)
    })

    test('a selection dragged from inside and released outside is not', () => {
        const p = createOutsidePress(isInside)
        p.down(PANEL)
        expect(p.isOutsideClick(BACKDROP)).toBe(false)
    })

    test('press outside released inside is not', () => {
        const p = createOutsidePress(isInside)
        p.down(BACKDROP)
        expect(p.isOutsideClick(PANEL)).toBe(false)
    })

    test('the press is consumed: the next real outside click still closes', () => {
        const p = createOutsidePress(isInside)
        p.down(PANEL)
        expect(p.isOutsideClick(BACKDROP)).toBe(false)
        p.down(BACKDROP)
        expect(p.isOutsideClick(BACKDROP)).toBe(true)
    })

    test('a click with no recorded press counts by its own target', () => {
        const p = createOutsidePress(isInside)
        expect(p.isOutsideClick(BACKDROP)).toBe(true)
        expect(p.isOutsideClick(PANEL)).toBe(false)
    })
})
