// core/test/shellLayout.test.ts
import { describe, expect, it } from 'bun:test'
import {
    SIDEBAR_SECTIONS,
    normalizeSidebarSections,
    otherSide,
} from '../src/shellLayout'

describe('otherSide', () => {
    it('flips left and right', () => {
        expect(otherSide('left')).toBe('right')
        expect(otherSide('right')).toBe('left')
    })
})

describe('normalizeSidebarSections', () => {
    it('keeps a valid list in order', () => {
        expect(normalizeSidebarSections(['files', 'graph', 'toolbar'])).toEqual(
            ['files', 'graph', 'toolbar'],
        )
    })
    it('honours an omitted section and an empty list', () => {
        expect(normalizeSidebarSections(['toolbar', 'files'])).toEqual([
            'toolbar',
            'files',
        ])
        expect(normalizeSidebarSections([])).toEqual([])
    })
    it('drops unknown ids and non-strings', () => {
        expect(normalizeSidebarSections(['nope', 'files', 3, null])).toEqual([
            'files',
        ])
    })
    it('keeps the first occurrence of a duplicate', () => {
        expect(
            normalizeSidebarSections(['graph', 'files', 'graph', 'files']),
        ).toEqual(['graph', 'files'])
    })
    it('falls back to a copy of the default order for a non-array', () => {
        for (const bad of [undefined, null, 'files', 4, {}]) {
            const out = normalizeSidebarSections(bad)
            expect(out).toEqual(['toolbar', 'files', 'graph'])
            expect(out).not.toBe(SIDEBAR_SECTIONS as unknown)
        }
    })
    it('default order is toolbar, files, graph', () => {
        expect([...SIDEBAR_SECTIONS]).toEqual(['toolbar', 'files', 'graph'])
    })
})
