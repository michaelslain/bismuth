// app/src/icons/specimen/iconSetData.test.ts
import { describe, expect, test } from 'bun:test'
import {
    CANONICAL_NAMES,
    ICON_SETS,
    getIconBody,
    computeCoverage,
    allCoverage,
    phosphorRegularGaps,
} from './iconSetData'

describe('CANONICAL_NAMES', () => {
    test('has all 140 real app icon names', () => {
        expect(CANONICAL_NAMES.length).toBe(140)
    })

    test('has no duplicates', () => {
        expect(new Set(CANONICAL_NAMES).size).toBe(CANONICAL_NAMES.length)
    })
})

describe('ICON_SETS', () => {
    test('declares exactly 5 columns', () => {
        expect(ICON_SETS.length).toBe(5)
    })

    test('exactly one set is chosen', () => {
        expect(ICON_SETS.filter(s => s.chosen).length).toBe(1)
    })

    test('the chosen set is Phosphor Regular', () => {
        const chosen = ICON_SETS.find(s => s.chosen)
        expect(chosen?.id).toBe('phosphorRegular')
    })
})

describe('getIconBody - nerd (incumbent)', () => {
    test('resolves a known name to a glyph', () => {
        const body = getIconBody('nerd', 'Plus')
        expect(body).not.toBeNull()
        expect(body?.kind).toBe('glyph')
        expect(body?.content.length).toBeGreaterThan(0)
    })

    test('returns null for an unknown name', () => {
        expect(getIconBody('nerd', 'NotARealIconName')).toBeNull()
    })

    test('covers all 140 names (the incumbent has full coverage by construction)', () => {
        const cov = computeCoverage('nerd')
        expect(cov.resolved).toBe(140)
        expect(cov.total).toBe(140)
    })
})

describe('getIconBody - phosphorRegular (chosen set)', () => {
    test('resolves an easy name (Plus) to real SVG markup', () => {
        const body = getIconBody('phosphorRegular', 'Plus')
        expect(body).not.toBeNull()
        expect(body?.kind).toBe('svg')
        expect(body?.content).toContain('<path')
        expect(body?.custom).not.toBe(true)
    })

    test('resolves the 9 remapped names from the original 15 misses', () => {
        const remapped = [
            'BrainCircuit',
            'Columns3',
            'Inbox',
            'Layers',
            'ListOrdered',
            'Menu',
            'PanelBottom',
            'SeparatorHorizontal',
            'Sigma',
        ]
        for (const name of remapped) {
            const body = getIconBody('phosphorRegular', name)
            expect(body).not.toBeNull()
            expect(body?.kind).toBe('svg')
        }
    })

    test('Regex resolves to a hand-authored custom mark, not a real Phosphor icon', () => {
        const body = getIconBody('phosphorRegular', 'Regex')
        expect(body).not.toBeNull()
        expect(body?.custom).toBe(true)
        expect(body?.content).toContain('.*')
    })

    test('WholeWord resolves to a hand-authored custom mark, not a real Phosphor icon', () => {
        const body = getIconBody('phosphorRegular', 'WholeWord')
        expect(body).not.toBeNull()
        expect(body?.custom).toBe(true)
        expect(body?.content).toContain('[W]')
    })

    test('the 5 genuinely absent names return null, not a fabricated fallback', () => {
        for (const name of [
            'ArchiveX',
            'Blend',
            'FolderInput',
            'Map',
            'Vote',
        ]) {
            expect(getIconBody('phosphorRegular', name)).toBeNull()
        }
    })

    test('phosphorRegularGaps() reports exactly the 5 true gaps', () => {
        expect(phosphorRegularGaps().sort()).toEqual(
            ['ArchiveX', 'Blend', 'FolderInput', 'Map', 'Vote'].sort(),
        )
    })

    test('coverage counting real art (SVG, real or custom) is 135/140', () => {
        const cov = computeCoverage('phosphorRegular')
        expect(cov.resolved).toBe(135)
        expect(cov.total).toBe(140)
    })
})

describe('getIconBody - phosphorThin', () => {
    test('resolves the same names as phosphorRegular (same manifest, different weight)', () => {
        const body = getIconBody('phosphorThin', 'Plus')
        expect(body).not.toBeNull()
        expect(body?.kind).toBe('svg')
    })

    test('does NOT get the hand-authored Regex/WholeWord marks (those exist only for the chosen column)', () => {
        expect(getIconBody('phosphorThin', 'Regex')).toBeNull()
        expect(getIconBody('phosphorThin', 'WholeWord')).toBeNull()
    })
})

describe('coverage is measured, not asserted', () => {
    test('every set has resolved <= total and both are positive', () => {
        for (const cov of allCoverage()) {
            expect(cov.resolved).toBeGreaterThan(0)
            expect(cov.resolved).toBeLessThanOrEqual(cov.total)
            expect(cov.total).toBe(140)
        }
    })

    test('radix coverage matches the verified mapping table size', () => {
        const cov = computeCoverage('radix')
        expect(cov.resolved).toBe(84)
    })

    test('iconoir coverage matches the verified mapping table size', () => {
        const cov = computeCoverage('iconoir')
        expect(cov.resolved).toBe(104)
    })

    test('phosphorRegular beats radix and iconoir on raw name coverage', () => {
        const ph = computeCoverage('phosphorRegular')
        const radix = computeCoverage('radix')
        const iconoir = computeCoverage('iconoir')
        expect(ph.resolved).toBeGreaterThan(radix.resolved)
        expect(ph.resolved).toBeGreaterThan(iconoir.resolved)
    })
})
