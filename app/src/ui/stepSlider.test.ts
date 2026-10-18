import { describe, it, expect } from 'bun:test'
import { stepAction, stepIndex, nearestStop } from './stepSliderLogic'

describe('stepAction', () => {
    it('maps the slider keys', () => {
        expect(stepAction({ key: 'ArrowRight' })).toBe('next')
        expect(stepAction({ key: 'ArrowLeft' })).toBe('prev')
        expect(stepAction({ key: 'Home' })).toBe('home')
        expect(stepAction({ key: 'End' })).toBe('end')
    })
    it('ignores other keys', () => {
        expect(stepAction({ key: 'a' })).toBeNull()
        expect(stepAction({ key: 'Tab' })).toBeNull()
    })
})

describe('stepIndex', () => {
    it('steps and clamps', () => {
        expect(stepIndex(4, 0, 'next')).toBe(1)
        expect(stepIndex(4, 3, 'next')).toBe(3)
        expect(stepIndex(4, 0, 'prev')).toBe(0)
        expect(stepIndex(4, 2, 'prev')).toBe(1)
    })
    it('jumps home and end', () => {
        expect(stepIndex(4, 2, 'home')).toBe(0)
        expect(stepIndex(4, 1, 'end')).toBe(3)
    })
    it('from no selection lands on the first stop', () => {
        expect(stepIndex(4, -1, 'next')).toBe(0)
        expect(stepIndex(4, -1, 'prev')).toBe(0)
    })
    it('has no index with no stops', () => {
        expect(stepIndex(0, -1, 'next')).toBe(-1)
    })
})

describe('nearestStop', () => {
    const centres = [10, 50, 90, 130]
    it('picks the closest centre', () => {
        expect(nearestStop(0, centres)).toBe(0)
        expect(nearestStop(61, centres)).toBe(1)
        expect(nearestStop(71, centres)).toBe(2)
        expect(nearestStop(500, centres)).toBe(3)
    })
    it('ties go to the earlier stop', () => {
        expect(nearestStop(30, centres)).toBe(0)
    })
    it('is -1 with no stops', () => {
        expect(nearestStop(5, [])).toBe(-1)
    })
})
