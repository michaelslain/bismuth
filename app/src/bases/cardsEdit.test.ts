import { describe, expect, it } from 'bun:test'
import {
    deletedLabel,
    insertAt,
    moveItem,
    parseBulk,
    removeAt,
    validCards,
} from './cardsEdit'

describe('parseBulk', () => {
    it('auto-detects the most specific separator first', () => {
        expect(parseBulk('a :: b:c', 'auto')).toEqual([
            { front: 'a', back: 'b:c' },
        ])
    })
    it('a line with no separator has an empty back', () => {
        expect(parseBulk('lonely', 'auto')).toEqual([
            { front: 'lonely', back: '' },
        ])
    })
    it('an explicit separator wins over auto sniffing', () => {
        expect(parseBulk('a :: b | c', 'pipe')).toEqual([
            { front: 'a :: b', back: 'c' },
        ])
    })
    it('skips blank lines and trims', () => {
        expect(parseBulk('\n  x\ty  \r\n\n', 'tab')).toEqual([
            { front: 'x', back: 'y' },
        ])
    })
})

describe('validCards', () => {
    it('keeps only cards with a front', () => {
        expect(
            validCards([
                { front: '', back: 'orphan' },
                { front: 'ok', back: '' },
            ]),
        ).toEqual([{ front: 'ok', back: '' }])
    })
})

describe('list helpers', () => {
    it('moveItem mirrors splice-out-then-splice-in and copies', () => {
        const src = ['a', 'b', 'c', 'd']
        expect(moveItem(src, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
        expect(moveItem(src, 3, 1)).toEqual(['a', 'd', 'b', 'c'])
        expect(src).toEqual(['a', 'b', 'c', 'd'])
    })
    it('removeAt / insertAt are inverses', () => {
        const src = ['a', 'b', 'c']
        expect(insertAt(removeAt(src, 1), 1, 'b')).toEqual(src)
    })
})

describe('deletedLabel', () => {
    it('names the card by its front, trimmed and capped', () => {
        expect(deletedLabel({ front: '  Capital of France?  ' }, 'front')).toBe(
            'Capital of France?',
        )
        const long = 'x'.repeat(60)
        expect(deletedLabel({ front: long }, 'front').length).toBeLessThanOrEqual(
            28,
        )
    })
    it('falls back when the front is empty', () => {
        expect(deletedLabel({ front: '' }, 'front')).toBe('card')
    })
})
