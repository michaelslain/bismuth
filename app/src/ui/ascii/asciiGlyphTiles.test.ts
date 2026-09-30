import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
    EDGE_KEYS,
    edgeAttrs,
    edgeSelector,
    edgesKey,
    fitTiles,
    glyphOrigin,
    installKey,
    spriteGlyphs,
    spriteVar,
    tileCacheKey,
    tileSize,
} from './asciiGlyphTiles'

describe('edgesKey', () => {
    test('defaults to top + left in rule weight', () => {
        expect(edgesKey(undefined, undefined, undefined)).toBe('1001')
    })
    test('orders top right bottom left and carries per-edge weight', () => {
        expect(edgesKey(['left', 'bottom', 'right', 'top'], 'rule', { bottom: 'heavy' })).toBe('1121')
        expect(edgesKey(['top', 'left'], 'heavy', { bottom: 'rule' })).toBe('2001')
        expect(edgesKey(['top', 'left', 'right'], undefined, { top: 'heavy' })).toBe('2101')
    })
    test('a weight on an undrawn edge draws nothing', () => {
        expect(edgesKey(['left'], 'heavy', { bottom: 'heavy' })).toBe('0001')
        expect(edgesKey([], undefined, undefined)).toBe('0000')
    })
})

describe('EDGE_KEYS', () => {
    test('covers every inked edge set once', () => {
        expect(EDGE_KEYS.length).toBe(35)
        expect(new Set(EDGE_KEYS).size).toBe(35)
        expect(EDGE_KEYS).not.toContain('0000')
        expect(EDGE_KEYS).toContain(edgesKey(['top', 'right', 'bottom', 'left'], 'heavy', undefined))
    })
})

describe('spriteGlyphs', () => {
    test('a corner is typed only where both of its edges are drawn', () => {
        expect(spriteGlyphs('1001')).toEqual(['+', '-', '', '|', '', '', '', '', ''])
        expect(spriteGlyphs('1121')).toEqual(['+', '-', '+', '|', '', '|', '+', '=', '+'])
        expect(spriteGlyphs('0010')).toEqual(['', '', '', '', '', '', '', '-', ''])
    })
})

describe('tileCacheKey', () => {
    test('changes with font, size, cell height and dpr only', () => {
        const k = tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2)).toBe(k)
        expect(tileCacheKey('Lora', 11.5, 18, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 12, 18, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 20, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 1)).not.toBe(k)
    })
})

describe('installKey', () => {
    test('tiles drawn from a fallback face are redrawn once the real face loads', () => {
        const base = tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2)
        // install() skips when key === installedKey: fallback first, then ready must NOT match
        const drawnFallback = installKey(base, false)
        const afterLoad = installKey(base, true)
        expect(afterLoad).not.toBe(drawnFallback)
        expect(afterLoad).toBe(base)
    })
    test('a permanently missing face keeps one stable fallback key (no redraw per call)', () => {
        const base = tileCacheKey('Lora', 12, 18, 1)
        expect(installKey(base, false)).toBe(installKey(base, false))
    })
    test('a different face never collides with another face fallback key', () => {
        expect(installKey(tileCacheKey('A', 12, 18, 1), false)).not.toBe(installKey(tileCacheKey('B', 12, 18, 1), false))
    })
})

describe('tileSize', () => {
    test('bitmap is whole device pixels, painted 1:1', () => {
        expect(tileSize(6.9, 18, 1)).toEqual({ bw: 7, bh: 18, cssW: 7, cssH: 18 })
        expect(tileSize(6.9, 18, 2)).toEqual({ bw: 14, bh: 36, cssW: 7, cssH: 18 })
        const t = tileSize(6.9, 18, 3)
        expect(t.bw).toBe(21)
        expect(Math.abs(t.cssW - 6.9)).toBeLessThanOrEqual(0.5 / 3)
    })
})

describe('fitTiles', () => {
    test('a whole number of tiles, stretched by under 1/(2n)', () => {
        for (const room of [7, 50, 102.25, 145.75, 593, 600.4, 1000]) {
            const { n, pitch, stretch } = fitTiles(room, 7)
            expect(Number.isInteger(n)).toBe(true)
            expect(n * pitch).toBeCloseTo(room, 9)
            expect(Math.abs(stretch)).toBeLessThanOrEqual(1 / (2 * n) + 1e-9)
        }
    })
    test('never zero tiles', () => {
        expect(fitTiles(2, 7).n).toBe(1)
    })
})

describe('glyphOrigin', () => {
    test('puts the ink centre on the tile centre', () => {
        const ink = { left: -1, right: 6, ascent: 7, descent: -1 }
        const o = glyphOrigin(7, 18, ink)
        // ink x centre = origin + (right - left)/2 ; ink y centre = baseline + (descent - ascent)/2
        expect(o.x + (ink.right - ink.left) / 2).toBeCloseTo(3.5, 9)
        expect(o.y + (ink.descent - ink.ascent) / 2).toBeCloseTo(9, 9)
    })
})

describe('edgeAttrs (the data-edges / data-heavy contract)', () => {
    test('drawn edges in top right bottom left order, heavy ones separately', () => {
        expect(edgeAttrs('1001')).toEqual({ edges: 'top left', heavy: undefined })
        expect(edgeAttrs('1121')).toEqual({ edges: 'top right bottom left', heavy: 'bottom' })
        expect(edgeAttrs('2120')).toEqual({ edges: 'top right bottom', heavy: 'top bottom' })
        expect(edgeAttrs('0001')).toEqual({ edges: 'left', heavy: undefined })
    })
    test('every key has its own selector', () => {
        const sels = EDGE_KEYS.map(edgeSelector)
        expect(new Set(sels).size).toBe(EDGE_KEYS.length)
        expect(edgeSelector('1001')).toBe("[data-edges='top left']:not([data-heavy])")
        expect(edgeSelector('2001')).toBe("[data-edges='top left'][data-heavy='top']")
    })
})

describe('AsciiCellEdges.module.css', () => {
    test('the stylesheet has exactly one rule per key, wired to its sprite var', () => {
        const css = readFileSync(new URL('./AsciiCellEdges.module.css', import.meta.url), 'utf8')
        for (const k of EDGE_KEYS)
            expect(css).toContain(`.edges${edgeSelector(k)} { -webkit-mask-box-image-source: var(${spriteVar(k)},`)
        expect(css.split('\n').filter(l => l.startsWith('.edges[')).length).toBe(EDGE_KEYS.length)
    })
})
