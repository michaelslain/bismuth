import { describe, it, expect } from 'bun:test'
import {
    gridTemplateAreas,
    gridTemplateColumns,
    shellColumns,
} from './shellColumns'

describe('shellColumns', () => {
    it('default: sidebar left, rail right', () => {
        expect(shellColumns('left', 'right')).toEqual(['sidebar', 'main', 'rail'])
    })
    it('mirrored: sidebar right, rail left', () => {
        expect(shellColumns('right', 'left')).toEqual(['rail', 'main', 'sidebar'])
    })
    it('both left: sidebar outermost', () => {
        expect(shellColumns('left', 'left')).toEqual(['sidebar', 'rail', 'main'])
    })
    it('both right: sidebar outermost', () => {
        expect(shellColumns('right', 'right')).toEqual(['main', 'rail', 'sidebar'])
    })
})

describe('grid templates', () => {
    it('columns for the default', () => {
        expect(gridTemplateColumns(shellColumns('left', 'right'))).toBe(
            'var(--sidebar-w) 1fr var(--rail-w)',
        )
    })
    it('columns for both right', () => {
        expect(gridTemplateColumns(shellColumns('right', 'right'))).toBe(
            '1fr var(--rail-w) var(--sidebar-w)',
        )
    })
    it('areas', () => {
        expect(gridTemplateAreas(['sidebar', 'main', 'rail'])).toBe(
            '"sidebar main rail"',
        )
    })
})
