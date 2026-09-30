import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
    EDGE_KEYS,
    edgeAttrs,
    edgeSelector,
    dashOffset,
    edgesKey,
    fitTiles,
    glyphOrigin,
    installKey,
    spriteGlyphs,
    spriteVar,
    tileCacheKey,
    tileGeometry,
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
    test('changes with font, size, cell height, dpr and dash pitch only', () => {
        const k = tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2)).toBe(k)
        expect(tileCacheKey('Lora', 11.5, 18, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 12, 18, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 20, 2)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 1)).not.toBe(k)
        expect(tileCacheKey('"Monaspace Xenon", monospace', 11.5, 18, 2, 3)).not.toBe(k)
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

describe('tileGeometry', () => {
    // Monaspace Xenon at 11.5px, dpr 2, as the face paints them: a 6px `-`, a 5.5 x 5.5px `+`
    const xenon = { dashW: 6, plusW: 5.5, plusH: 5.5 }
    test('bitmap is whole device pixels, painted 1:1', () => {
        const g = tileGeometry(7.13, xenon, 2)
        expect(g.bw).toBe(14)
        expect(g.cssW).toBe(7)
        expect(g.cssH).toBe(g.cy / 2)
        expect(g.cssCornerW).toBe(g.cx / 2)
        expect(g.cssPitch).toBe(g.pitch / 2)
        const t = tileGeometry(6.9, xenon, 3)
        expect(t.bw).toBe(21)
        expect(Math.abs(t.cssW - 6.9)).toBeLessThanOrEqual(0.5 / 3)
    })
    test('one dash, one pitch, one gap on both axes: a dash then a blank `ch` by default', () => {
        const g = tileGeometry(7.13, xenon, 2)
        expect(g.pitch).toBe(2 * g.bw)
        expect(g.dash).toBe(12)
        expect(g.gap).toBe(16)
        expect(g.gap).toBe(g.pitch - g.dash)
        // the pitch is the token's, in `ch` tiles
        expect(tileGeometry(7.13, xenon, 2, 3).pitch).toBe(3 * g.bw)
        expect(tileGeometry(7.13, xenon, 2, 1).gap).toBe(2)
    })
    test('a corner is the `+` ink + one gap each way, even, so + to first dash = one gap (+-1)', () => {
        for (const dpr of [1, 1.5, 2, 3])
            for (const ink of [xenon, { dashW: 4.2, plusW: 5, plusH: 6 }, { dashW: 5, plusW: 7, plusH: 7 }]) {
                const g = tileGeometry(7.13, ink, dpr)
                expect(g.cx % 2).toBe(0)
                expect(g.cy % 2).toBe(0)
                const d0 = dashOffset(g.pitch, g.dash)
                // + arm end to the corner tile edge, then the run tile's lead-in to its dash
                const plusW = Math.round(ink.plusW * dpr)
                const plusH = Math.round(ink.plusH * dpr)
                const across = [Math.floor((g.cx - plusW) / 2), g.cx - plusW - Math.floor((g.cx - plusW) / 2)]
                const down = [Math.floor((g.cy - plusH) / 2), g.cy - plusH - Math.floor((g.cy - plusH) / 2)]
                const tail = g.pitch - d0 - g.dash
                for (const lead of [...across, ...down])
                    for (const run of [d0, tail]) expect(Math.abs(lead + run - g.gap)).toBeLessThanOrEqual(1.5)
            }
        expect(tileGeometry(7.13, xenon, 2).cy).toBe(28)
    })
    test('never degenerate', () => {
        const g = tileGeometry(0.1, { dashW: 9, plusW: 0, plusH: 0 }, 1)
        expect(g.bw).toBeGreaterThanOrEqual(1)
        expect(g.gap).toBe(0)
        expect(g.dash).toBeLessThanOrEqual(g.pitch)
        expect(g.cx).toBeGreaterThanOrEqual(2)
        expect(g.cy).toBeGreaterThanOrEqual(2)
    })
})

describe('dashOffset', () => {
    test('centres a dash in its pitch: half a gap each side (+-1)', () => {
        expect(dashOffset(28, 12)).toBe(8)
        expect(dashOffset(27, 12)).toBe(7)
        expect(dashOffset(10, 12)).toBe(0)
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
