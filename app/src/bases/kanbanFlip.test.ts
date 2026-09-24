import { describe, expect, test } from 'bun:test'
import {
    cardDropIndex,
    cardFlipTransform,
    columnFlipTransform,
    isAfterMidpoint,
    playFlipFrom,
    snapshotFlip,
} from './kanbanFlip'

// A stand-in for the few DOM members the FLIP helpers touch: a keyed element with a mutable rect
// and a style bag, under a root whose querySelectorAll ignores the selector (the tests pass the
// matching set directly).
type FakeEl = {
    key: string
    rect: { left: number; top: number }
    style: { transition: string; transform: string }
    getBoundingClientRect: () => DOMRect
}
function el(key: string, left: number, top: number): FakeEl {
    const e: FakeEl = {
        key,
        rect: { left, top },
        style: { transition: '', transform: '' },
        getBoundingClientRect: () => ({ ...e.rect }) as DOMRect,
    }
    return e
}
function root(els: FakeEl[]): ParentNode {
    return { querySelectorAll: () => els } as unknown as ParentNode
}
const keyOf = (e: HTMLElement) => (e as unknown as FakeEl).key

describe('snapshotFlip + playFlipFrom', () => {
    test('a moved element is inverted to its old spot, then released to rest', () => {
        const a = el('a', 0, 0)
        const b = el('b', 0, 50)
        const map = new Map<string, DOMRect>()
        snapshotFlip(root([a, b]), map, '*', keyOf)
        expect(map.size).toBe(2)
        b.rect = { left: 0, top: 100 } // b slid down 50px
        playFlipFrom(root([a, b]), map, '*', keyOf, cardFlipTransform, 180)
        expect(b.style.transform).toBe('translate(0, 0)')
        expect(b.style.transition).toBe(
            'transform 180ms cubic-bezier(.2,.7,.2,1)',
        )
        // a didn't move — untouched
        expect(a.style.transform).toBe('')
        expect(a.style.transition).toBe('')
        // the snapshot is consumed
        expect(map.size).toBe(0)
    })

    test('no root → snapshot leaves the map alone, play is a no-op', () => {
        const map = new Map<string, DOMRect>([['x', {} as DOMRect]])
        snapshotFlip(undefined, map, '*', keyOf)
        expect(map.size).toBe(1)
        playFlipFrom(undefined, map, '*', keyOf, cardFlipTransform, 180)
        expect(map.size).toBe(1)
    })

    test('elements with no key or no snapshot are skipped', () => {
        const a = el('a', 0, 0)
        const map = new Map<string, DOMRect>()
        snapshotFlip(root([a]), map, '*', () => null)
        expect(map.size).toBe(0)
        const fresh = el('fresh', 10, 10)
        map.set('other', { left: 0, top: 0 } as DOMRect)
        playFlipFrom(root([fresh]), map, '*', keyOf, cardFlipTransform, 180)
        expect(fresh.style.transform).toBe('')
    })
})

describe('flip transforms', () => {
    test('card: both axes, null when still', () => {
        expect(cardFlipTransform(0, 0)).toBeNull()
        expect(cardFlipTransform(3, -4)).toEqual({
            from: 'translate(3px, -4px)',
            to: 'translate(0, 0)',
        })
    })
    test('column: x only — a pure vertical shift is ignored', () => {
        expect(columnFlipTransform(0)).toBeNull()
        expect(columnFlipTransform(-20)).toEqual({
            from: 'translateX(-20px)',
            to: 'translateX(0)',
        })
    })
})

describe('cardDropIndex', () => {
    const cards = [
        { top: 0, height: 40 }, // mid 20
        { top: 50, height: 40 }, // mid 70
        { top: 100, height: 40 }, // mid 120
    ]
    const rectOf = (c: { top: number; height: number }) => c
    test('above a card midpoint → that slot', () => {
        expect(cardDropIndex(cards, rectOf, 0)).toBe(0)
        expect(cardDropIndex(cards, rectOf, 19)).toBe(0)
        expect(cardDropIndex(cards, rectOf, 20)).toBe(1)
        expect(cardDropIndex(cards, rectOf, 119)).toBe(2)
    })
    test('below every midpoint (or an empty column) → the end', () => {
        expect(cardDropIndex(cards, rectOf, 500)).toBe(3)
        expect(cardDropIndex([], rectOf, 0)).toBe(0)
    })
    test('stops measuring at the first hit', () => {
        const seen: number[] = []
        cardDropIndex(
            cards,
            c => {
                seen.push(c.top)
                return c
            },
            30,
        )
        expect(seen).toEqual([0, 50])
    })
})

describe('isAfterMidpoint', () => {
    test('strictly right of the midpoint', () => {
        const r = { left: 100, width: 200 } // mid 200
        expect(isAfterMidpoint(150, r)).toBe(false)
        expect(isAfterMidpoint(200, r)).toBe(false)
        expect(isAfterMidpoint(201, r)).toBe(true)
    })
})
