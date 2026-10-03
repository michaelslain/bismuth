import { describe, expect, it } from 'bun:test'
import { startIndex, step } from './introPager'

const slides = [{ key: 'welcome' }, { key: 'theme' }, { key: 'begin' }]

describe('step', () => {
    it('next advances without entering', () => {
        expect(step(0, 7, 'next')).toEqual({ index: 1, enter: false })
        expect(step(5, 7, 'next')).toEqual({ index: 6, enter: false })
    })
    it('next on the last slide stays and asks to enter', () => {
        expect(step(6, 7, 'next')).toEqual({ index: 6, enter: true })
    })
    it('prev steps back and stops at 0', () => {
        expect(step(3, 7, 'prev')).toEqual({ index: 2, enter: false })
        expect(step(0, 7, 'prev')).toEqual({ index: 0, enter: false })
    })
    it('skip jumps to the last slide without entering', () => {
        expect(step(1, 7, 'skip')).toEqual({ index: 6, enter: false })
    })
    it('go clamps both ends and passes an in-range target through', () => {
        expect(step(3, 7, 'go', -1)).toEqual({ index: 0, enter: false })
        expect(step(3, 7, 'go', 99)).toEqual({ index: 6, enter: false })
        expect(step(3, 7, 'go', 4)).toEqual({ index: 4, enter: false })
    })
})

describe('startIndex', () => {
    it('finds a known key', () => {
        expect(startIndex(slides, 'begin')).toBe(2)
    })
    it('falls back to 0 for an unknown or absent key', () => {
        expect(startIndex(slides, 'nope')).toBe(0)
        expect(startIndex(slides, undefined)).toBe(0)
    })
})
