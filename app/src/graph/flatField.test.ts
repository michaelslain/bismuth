import { describe, expect, test } from 'bun:test'
import {
    FIXED_CUTS,
    EDGE_DENSITY_FLOOR,
    EDGE_DENSITY_KNEE,
    FIELD_LABEL_MAX_CHARS,
    clipFieldLabel,
    degreeCuts,
    edgeDensityAlpha,
    flatGlyphTier,
    isFanEdge,
    tierForCuts,
} from './flatField'

describe('degreeCuts', () => {
    test('a small graph keeps the fixed ramp', () => {
        expect(degreeCuts([0, 1, 1, 2, 3, 2, 1])).toEqual(FIXED_CUTS)
        expect(degreeCuts([])).toEqual(FIXED_CUTS)
    })

    test('a big vault-shaped distribution makes "@" rare and "." the common case', () => {
        // the reference vault's shape: most notes at degree 2, a long tail of tags and hubs
        const degrees: number[] = []
        for (let i = 0; i < 1100; i++) degrees.push(2)
        for (let i = 0; i < 470; i++) degrees.push(1)
        for (let i = 0; i < 400; i++) degrees.push(3 + (i % 4))
        for (let i = 0; i < 250; i++) degrees.push(7 + (i % 9))
        for (let i = 0; i < 50; i++) degrees.push(40 + i * 12)
        const cuts = degreeCuts(degrees)
        const tiers = degrees.map(d => tierForCuts(d, cuts))
        const share = (t: number) => tiers.filter(x => x === t).length / tiers.length
        expect(share(2)).toBeLessThan(0.05)
        expect(share(1)).toBeLessThan(0.35)
        expect(share(0)).toBeGreaterThan(0.6)
        expect(cuts.hub).toBeGreaterThan(cuts.linked)
    })

    test('cuts never drop below the fixed ramp', () => {
        const cuts = degreeCuts(Array(100).fill(0))
        expect(cuts.linked).toBeGreaterThanOrEqual(FIXED_CUTS.linked)
        expect(cuts.hub).toBeGreaterThanOrEqual(FIXED_CUTS.hub)
    })
})

describe('tierForCuts', () => {
    test('matches the ascii ramp tiers', () => {
        const cuts = { linked: 4, hub: 20 }
        expect(tierForCuts(3, cuts)).toBe(0)
        expect(tierForCuts(4, cuts)).toBe(1)
        expect(tierForCuts(20, cuts)).toBe(2)
    })
})

describe('edgeDensityAlpha', () => {
    test('a sparse field keeps full alpha', () => {
        expect(edgeDensityAlpha(149, 5000)).toBe(1)
        expect(edgeDensityAlpha(0, 5000)).toBe(1)
        expect(edgeDensityAlpha(10, 0)).toBe(1)
    })

    test('fades as density climbs, monotonically, to the floor', () => {
        const cells = 5000
        const at = (r: number) => edgeDensityAlpha(r * cells, cells)
        expect(at(EDGE_DENSITY_KNEE)).toBe(1)
        expect(at(0.5)).toBeLessThan(1)
        expect(at(1)).toBeLessThan(at(0.5))
        expect(at(100)).toBe(EDGE_DENSITY_FLOOR)
    })
})

describe('isFanEdge', () => {
    test('either endpoint at hub degree makes it a fan edge', () => {
        const cuts = { linked: 3, hub: 10 }
        expect(isFanEdge(2, 3, cuts)).toBe(false)
        expect(isFanEdge(2, 10, cuts)).toBe(true)
        expect(isFanEdge(687, 1, cuts)).toBe(true)
    })
})

describe('clipFieldLabel', () => {
    test('short names pass through', () => {
        expect(clipFieldLabel('Human Compatible')).toBe('Human Compatible')
    })

    test('long names clip to the max with an ellipsis and no trailing space', () => {
        const out = clipFieldLabel('Ludwig Feuerbach and the End of Classical German Philosophy')
        expect(out.length).toBeLessThanOrEqual(FIELD_LABEL_MAX_CHARS)
        expect(out.endsWith('…')).toBe(true)
        expect(out).not.toMatch(/ …$/)
    })
})

describe('flatGlyphTier', () => {
    test('2D keeps the rank tier', () => {
        expect(flatGlyphTier(0, 1, false)).toBe(0)
        expect(flatGlyphTier(2, 0, false)).toBe(2)
    })

    test('3D depth only demotes: far steps down, near never promotes a leaf', () => {
        expect(flatGlyphTier(0, 0.99, true)).toBe(0) // near leaf stays "."
        expect(flatGlyphTier(2, 0.99, true)).toBe(2) // near hub stays "@"
        expect(flatGlyphTier(2, 0.01, true)).toBe(1) // far hub steps down
        expect(flatGlyphTier(0, 0.01, true)).toBe(0) // never below "."
        expect(flatGlyphTier(1, 0.5, true)).toBe(1) // middle band untouched
    })
})
